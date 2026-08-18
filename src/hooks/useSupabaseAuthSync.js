import { useEffect, useState } from 'react';
import { supabase } from '../services/supabaseClient';
import { registerForPushNotificationsAsync } from '../utils/notifications';
import { signInWithTelegram } from './useTelegramSignIn';
import { useUserStore } from '../store/useUserStore';
import { useWardrobeStore } from '../store/useWardrobeStore';
import { usePlannerStore } from '../store/usePlannerStore';

// Supabase's `user.user_metadata` shape depends on the provider — the
// telegram-verify Edge Function deliberately writes `full_name`/`avatar_url`
// into `user_metadata` at createUser time (see
// supabase/functions/telegram-verify/index.ts) so it lands in the same
// shape handle_new_auth_user() in 0001_init.sql already reads, with
// `name`/`picture` as a fallback for any other provider that used the raw
// OIDC claim names instead. `id` rides along so
// completeOnboarding/updateProfile/toggleStyleVibe in useUserStore know
// which `public.users` row to write back to.
// Exported — useTelegramSignIn.js (Deferred Registration: auth now happens
// at ScanSheet/RegistrationFlow's own last step, not in OnboardingScreen)
// needs this same mapping right after its verifyOtp call, before this
// hook's onAuthStateChange listener gets to it, so the two never drift into
// two different shapes for the same session.
export function mapSupabaseUser(user) {
  return {
    id: user.id,
    name: user.user_metadata?.full_name || user.user_metadata?.name || null,
    email: user.email,
    photo: user.user_metadata?.avatar_url || user.user_metadata?.picture || null,
    // Telegram's @handle — set only by telegram-verify (Google sign-in
    // never had a concept of one), null for that provider. ProfileScreen
    // shows this in place of `email` (a real Google address is meaningful
    // to show there; the synthetic tg_<id>@telegram.local one isn't).
    username: user.user_metadata?.telegram_username || null,
    // Raw numeric Telegram id — telegram-verify writes it into
    // user_metadata at createUser/updateUserById time (see
    // supabase/functions/telegram-verify/index.ts). Not sensitive (it's
    // the same id Telegram itself shows in the chat) — only used
    // client-side to decide whether to render ProfileScreen's admin
    // broadcast card; the actual broadcast Edge Function re-checks this
    // server-side and never trusts the client.
    telegramId: user.user_metadata?.telegram_id ?? null,
    createdAt: user.created_at || null,
  };
}

// Loads the client's row from `public.users` and applies it to useUserStore
// BEFORE flipping isLoggedIn on — never the other way around. If login()
// ran first, App.js would render one frame with isLoggedIn=true and
// whatever profile fields were left over from before (null on a cold
// start, or the *previous* account's values on a same-session re-login) —
// exactly the "always sent to Onboarding" bug this hook exists to fix, in
// both the cold-start case (Step 2's explicit ask) and the sign-out ->
// sign-back-in-without-restarting case (the client-reported symptom).
async function syncSession(session) {
  const { login, fetchProfile } = useUserStore.getState();
  await fetchProfile(session.user.id);

  login(mapSupabaseUser(session.user));

  // Fire-and-forget, deliberately not awaited: registering for push
  // notifications can mean showing the OS permission prompt, and nothing
  // about App.js's loading gate should block on the client answering that
  // — sessionReady flips true (see bootstrap() below) as soon as
  // syncSession's own body finishes, without waiting on this.
  syncPushToken();
}

// Compares a freshly obtained device token against what fetchProfile just
// loaded from public.users, and only writes when they actually differ —
// registerForPushNotificationsAsync() runs (and may re-prompt/re-resolve)
// on every login, but that shouldn't mean a Supabase UPDATE on every login
// too when the device already has the current token saved.
async function syncPushToken() {
  const token = await registerForPushNotificationsAsync();
  if (!token) return;

  const { pushToken, syncPushToken: saveToken } = useUserStore.getState();
  if (token !== pushToken) {
    saveToken(token);
  }
}

// Single source of truth for turning a Supabase auth session into
// useUserStore's isLoggedIn/user/profile — OnboardingScreen's Google
// sign-in (its last step) and ProfileScreen's Log Out button both just ask
// Supabase to change session state (signInWithIdToken / signOut) and let
// this hook react, rather than each call site separately calling
// login()/logout() on the store. That keeps a stale local "isLoggedIn" from
// ever drifting out of sync with whether a Supabase session (and therefore
// RLS access) actually exists.
//
// Returns `sessionReady` — false until the persisted session (if any) has
// been checked AND its profile fetched, so App.js can hold the loading
// screen instead of flashing Onboarding before a restored session's real
// profile data is in the store.
export function useSupabaseAuthSync() {
  const logout = useUserStore((state) => state.logout);
  const [sessionReady, setSessionReady] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function bootstrap() {
      try {
        const {
          data: { session },
        } = await supabase.auth.getSession();
        if (cancelled) return;

        if (session) {
          await syncSession(session);
        } else if (typeof window !== 'undefined' && window.Telegram?.WebApp?.initData) {
          // Running inside a real Telegram Mini App with no persisted
          // Supabase session yet — exchange the Mini App's own initData for
          // one silently, so `isLoggedIn` is already true before the first
          // screen ever renders (no separate "sign in" tap needed; Telegram
          // already told us who opened this). signInWithTelegram() does its
          // own fetchProfile/login — onAuthStateChange's SIGNED_IN branch
          // below fires a moment later from the resulting session and
          // harmlessly repeats that, same as every other sign-in path here.
          // A failure here (offline, bad/expired initData, opened outside
          // Telegram) just leaves the app in its existing guest state — the
          // Telegram button already rendered on ScanSheet/StylistScreen/
          // ProfileScreen for that case still works as a manual retry.
          const result = await signInWithTelegram();
          if (result.status === 'error') {
            console.warn('[useSupabaseAuthSync] Automatic Telegram sign-in failed:', result.error);
          }
        }
      } catch (err) {
        // A cold start with no network — or Supabase unreachable behind a
        // VPN/carrier block — throws a bare TypeError straight out of
        // auth-js's own fetch wrapper (getSession() calls it internally to
        // refresh an expired token); it's not a typed Supabase error with a
        // status code to branch on, just "this failed." Swallowing it and
        // falling through to sessionReady=true in `finally` below is
        // exactly what an already-supported "no session at all" cold start
        // does — offline-at-startup joins that same guest/local-data path
        // instead of crashing the whole app on a white/red screen.
        console.warn('[useSupabaseAuthSync] Could not restore session (offline or Supabase unreachable):', err);
      } finally {
        if (!cancelled) setSessionReady(true);
      }
    }

    bootstrap();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (session) {
        // Only a genuine new sign-in needs a fresh profile fetch.
        // `INITIAL_SESSION` (fired once on subscribe, reflecting whatever
        // bootstrap() above is already handling) and `TOKEN_REFRESHED`
        // (same user, same profile) would just be a redundant round-trip.
        if (event === 'SIGNED_IN') {
          // Not awaited (this callback isn't async) — but still needs a
          // .catch, otherwise a network failure here (same fetch-throws-
          // TypeError risk as bootstrap above, this time mid-session
          // rather than at cold start) is an unhandled promise rejection
          // instead of a message this hook can just log and move past.
          syncSession(session).catch((err) => {
            console.warn('[useSupabaseAuthSync] Post-sign-in profile sync failed:', err);
          });
        }
      } else {
        logout();
        // Wardrobe and Planner are separate stores (their own async
        // loading/error state) — clearing them here too means a second
        // account signing in on the same device never briefly renders the
        // first account's closet/plan before their own mount effects
        // re-fetch.
        useWardrobeStore.getState().reset();
        usePlannerStore.getState().reset();
      }
    });

    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return sessionReady;
}
