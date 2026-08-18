// Admin-only broadcast — invokes the broadcast-notification Edge Function
// (supabase/functions/broadcast-notification/index.ts), which re-checks the
// caller's own telegram_id against ADMIN_TELEGRAM_ID server-side before
// sending anything. This client-side call has no privilege of its own; the
// UI that calls it (ProfileScreen's admin card) is just a convenience gate
// so a non-admin never sees the composer in the first place.
import { supabase } from './supabaseClient';
import { extractFunctionErrorMessage } from './accountService';

export async function sendBroadcast(message) {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) {
    throw new Error('No active session — please sign in again before broadcasting.');
  }

  const { data, error } = await supabase.functions.invoke('broadcast-notification', {
    body: { message },
    headers: { Authorization: `Bearer ${session.access_token}` },
  });

  if (error) {
    const detail = await extractFunctionErrorMessage(error);
    console.log('[sendBroadcast] Edge Function error:', detail, error);
    throw new Error(detail);
  }

  return data;
}
