// Client side of the real Google Calendar integration (see
// supabase/functions/google-calendar-oauth-start, -oauth-callback, and
// -sync). Replaces calendarService.js's expo-calendar path on web — this
// app runs exclusively as web inside Telegram, where expo-calendar has no
// implementation at all.
import { Linking } from 'react-native';
import { supabase } from './supabaseClient';
import { extractFunctionErrorMessage } from './accountService';

async function invoke(name, body) {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) {
    throw new Error('No active session — please sign in again.');
  }
  const { data, error } = await supabase.functions.invoke(name, {
    body,
    headers: { Authorization: `Bearer ${session.access_token}` },
  });
  if (error) {
    throw new Error(await extractFunctionErrorMessage(error));
  }
  return data;
}

// Opens Google's consent screen in the SYSTEM browser — a Telegram Mini
// App's own WebView can't navigate to an external domain like
// accounts.google.com, only the surrounding Telegram client can hand off to
// a real browser tab for that. `WebApp.openLink` is Telegram's own API for
// exactly this (same `window.Telegram?.WebApp?.xxx` optional-chaining
// pattern App.js already uses for ready()/expand()); `Linking.openURL`
// covers the case of testing this outside Telegram, where
// `window.Telegram` is undefined.
export async function connectGoogleCalendar() {
  const { url } = await invoke('google-calendar-oauth-start', {});
  if (typeof window !== 'undefined' && window.Telegram?.WebApp?.openLink) {
    window.Telegram.WebApp.openLink(url);
  } else {
    await Linking.openURL(url);
  }
}

export async function disconnectGoogleCalendar() {
  await invoke('google-calendar-sync', { action: 'disconnect' });
}

// `date`: the calendar day (time-of-day ignored, same fixed-9am convention
// calendarService.js's own exportOutfitToCalendar already used).
// `itemNames`: joined into the event's description, same shape as before.
const EVENT_HOUR = 9;
const EVENT_DURATION_MS = 60 * 60 * 1000;

export async function exportToGoogleCalendar({ itemNames = [], date }) {
  const startDate = new Date(date);
  startDate.setHours(EVENT_HOUR, 0, 0, 0);
  const endDate = new Date(startDate.getTime() + EVENT_DURATION_MS);

  const data = await invoke('google-calendar-sync', {
    action: 'create',
    title: 'Shoom Outfit',
    notes: itemNames.join('\n'),
    startDateTime: startDate.toISOString(),
    endDateTime: endDate.toISOString(),
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  });
  return data.eventId;
}

export async function removeFromGoogleCalendar(eventId) {
  await invoke('google-calendar-sync', { action: 'delete', eventId });
}

// Surfaced so callers can special-case "not connected yet" / "connection
// expired, needs reconnect" without string-matching a generic error message
// — mirrors gemini.js's GeminiRateLimitError-style typed-error pattern.
export function isNotConnectedError(err) {
  return err?.message === 'NOT_CONNECTED' || err?.message === 'RECONNECT_REQUIRED';
}
