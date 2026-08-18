// Client side of Delete Account — invokes the delete-account Edge Function
// (supabase/functions/delete-account/index.ts) for the actual server-side
// deletion, then clears every locally persisted store so a re-login (even
// as a *different* account, same device) never shows a flash of stale data.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from './supabaseClient';
import { useUserStore } from '../store/useUserStore';
import { useWardrobeStore } from '../store/useWardrobeStore';
import { usePlannerStore } from '../store/usePlannerStore';
import { useChatStore } from '../store/useChatStore';

// supabase-js's own FunctionsHttpError/FunctionsRelayError (what
// `functions.invoke()` resolves `error` to on a non-2xx response) only ever
// carry a GENERIC message — literally the string "Edge Function returned a
// non-2xx status code" — on `error.message`. The real `{ error: "..." }`
// body the function itself returned (see
// supabase/functions/delete-account/index.ts's own catch block, which does
// return a real message) sits UNREAD on `error.context`, which is the raw
// fetch Response object, not yet parsed. This reads that body out so the
// caller — and the Alert in ProfileScreen's handleDeleteAccount — actually
// see the real reason (e.g. "Unauthorized.", a Storage error, or whatever
// the server-side try/catch caught), not just "non-2xx".
// Exported — broadcastService.js's sendBroadcast() needs the exact same
// "unwrap the Edge Function's real error body" logic as deleteAccount()
// below, not a second copy of it.
export async function extractFunctionErrorMessage(error) {
  const response = error?.context;
  if (!response || typeof response.clone !== 'function') {
    return error?.message || 'Unknown Edge Function error.';
  }

  // `.clone()` first — a Response body can only be read ONCE; without
  // cloning, a `.json()` call that throws (body wasn't valid JSON) leaves
  // the original body already consumed, so the `.text()` fallback below
  // would itself throw "body already used" instead of returning anything.
  try {
    const body = await response.clone().json();
    if (body?.error) return body.error;
  } catch (_jsonErr) {
    // Not JSON (or empty) — fall through to plain text.
  }

  try {
    const text = await response.text();
    if (text) return text;
  } catch (_textErr) {
    // Body already unreadable — nothing left to extract.
  }

  return error.message;
}

export async function deleteAccount() {
  // Session read fresh, right before the call, and its access token passed
  // EXPLICITLY as `Authorization: Bearer <token>` — supabase-js normally
  // keeps the Functions client's Authorization header in sync with the
  // current session on its own, but only reactively (on auth state change
  // events). Reading+passing it here directly removes any dependency on
  // that sync having already happened by the time this runs (e.g. right
  // after a cold app start, before the persisted session has finished
  // rehydrating) — a stale or missing token here is exactly what makes the
  // Edge Function's own `if (!authHeader)` / `getUser()` check reject the
  // request with 401, which used to show up client-side as just "non-2xx".
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) {
    throw new Error('No active session — please sign in again before deleting your account.');
  }

  const { error } = await supabase.functions.invoke('delete-account', {
    headers: { Authorization: `Bearer ${session.access_token}` },
  });

  if (error) {
    const detail = await extractFunctionErrorMessage(error);
    console.log('[deleteAccount] Edge Function error:', detail, error);
    throw new Error(detail);
  }

  // Session is already gone server-side (the auth user no longer exists) —
  // this just clears the locally cached tokens so supabase-js stops trying
  // to refresh them.
  await supabase.auth.signOut();

  useWardrobeStore.getState().reset();
  useUserStore.getState().logout();
  usePlannerStore.getState().reset();
  useChatStore.getState().clearMessages();

  // Belt-and-suspenders: each store's persist middleware writes to
  // AsyncStorage on its own schedule, so a broad clear() guarantees nothing
  // written moments before this ran survives on disk either.
  await AsyncStorage.clear();
}
