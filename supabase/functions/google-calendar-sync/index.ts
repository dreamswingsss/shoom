// Authenticated. One function handling `action: 'create'` / `'delete'` /
// `'disconnect'` so the access-token-refresh logic lives in exactly one
// place instead of being duplicated across several files. Writes to/reads from
// the caller's PRIMARY Google Calendar only — no multi-calendar picker like
// the old expo-calendar flow's CalendarPickerModal offered; the .ics
// download (src/utils/icsExport.js) is the answer for "I want a different
// calendar/app", not a second calendar-selection round trip here.
//
// Deploy: `supabase functions deploy google-calendar-sync`. Requires
// `GOOGLE_OAUTH_CLIENT_ID` + `GOOGLE_OAUTH_CLIENT_SECRET` (same client used
// by the oauth-start/oauth-callback pair, needed here only to refresh an
// expired access_token via the stored refresh_token).
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const GOOGLE_OAUTH_CLIENT_ID = Deno.env.get('GOOGLE_OAUTH_CLIENT_ID') ?? '';
const GOOGLE_OAUTH_CLIENT_SECRET = Deno.env.get('GOOGLE_OAUTH_CLIENT_SECRET') ?? '';
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

// A token is refreshed a minute early rather than exactly at `expires_at` —
// cheap insurance against the access token expiring mid-request on a slow
// connection.
const EXPIRY_SAFETY_MARGIN_MS = 60_000;

async function getValidAccessToken(
  adminClient: ReturnType<typeof createClient>,
  userId: string
): Promise<string> {
  const { data: row, error } = await adminClient
    .from('google_calendar_tokens')
    .select('access_token, refresh_token, expires_at')
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw error;
  if (!row) throw new Error('NOT_CONNECTED');

  const expiresAt = new Date(row.expires_at as string).getTime();
  if (Date.now() < expiresAt - EXPIRY_SAFETY_MARGIN_MS) {
    return row.access_token as string;
  }

  const refreshResponse = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: GOOGLE_OAUTH_CLIENT_ID,
      client_secret: GOOGLE_OAUTH_CLIENT_SECRET,
      refresh_token: row.refresh_token as string,
      grant_type: 'refresh_token',
    }),
  });
  const refreshData = await refreshResponse.json();
  if (!refreshResponse.ok || !refreshData.access_token) {
    // The refresh_token itself was revoked (user pulled access from their
    // Google account settings, not just from Shoom) — nothing left to do
    // but ask them to reconnect.
    await adminClient.from('google_calendar_tokens').delete().eq('user_id', userId);
    await adminClient.from('users').update({ google_calendar_connected: false }).eq('id', userId);
    throw new Error('RECONNECT_REQUIRED');
  }

  const newExpiresAt = new Date(Date.now() + refreshData.expires_in * 1000).toISOString();
  await adminClient
    .from('google_calendar_tokens')
    .update({ access_token: refreshData.access_token, expires_at: newExpiresAt })
    .eq('user_id', userId);

  return refreshData.access_token as string;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return json({ error: 'Missing Authorization header.' }, 401);
    }

    const callerClient = createClient(SUPABASE_URL, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: authHeader } },
    });
    const {
      data: { user },
      error: userError,
    } = await callerClient.auth.getUser();
    if (userError || !user) {
      return json({ error: 'Unauthorized.' }, 401);
    }

    const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const body = await req.json();

    // Disconnect doesn't need a valid (or even refreshable) access token —
    // handled before getValidAccessToken so a client whose refresh_token
    // was already revoked on Google's side can still clear their local
    // connection state instead of getting stuck behind a 409.
    if (body.action === 'disconnect') {
      const { data: row } = await adminClient
        .from('google_calendar_tokens')
        .select('access_token')
        .eq('user_id', user.id)
        .maybeSingle();
      if (row?.access_token) {
        // Best-effort — revoking with Google is a courtesy (so the client
        // shows up as disconnected in the user's own Google account
        // settings too), not something the disconnect itself depends on.
        await fetch(`https://oauth2.googleapis.com/revoke?token=${row.access_token}`, { method: 'POST' }).catch(
          () => {}
        );
      }
      await adminClient.from('google_calendar_tokens').delete().eq('user_id', user.id);
      await adminClient.from('users').update({ google_calendar_connected: false }).eq('id', user.id);
      return json({ ok: true }, 200);
    }

    let accessToken: string;
    try {
      accessToken = await getValidAccessToken(adminClient, user.id);
    } catch (err) {
      if (err instanceof Error && (err.message === 'NOT_CONNECTED' || err.message === 'RECONNECT_REQUIRED')) {
        return json({ error: err.message }, 409);
      }
      throw err;
    }

    if (body.action === 'create') {
      const { title, notes, startDateTime, endDateTime, timeZone } = body;
      if (!startDateTime || !endDateTime) {
        return json({ error: 'Missing startDateTime/endDateTime.' }, 400);
      }
      const response = await fetch('https://www.googleapis.com/calendar/v3/calendars/primary/events', {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          summary: title || 'Shoom Outfit',
          description: notes || '',
          start: { dateTime: startDateTime, timeZone },
          end: { dateTime: endDateTime, timeZone },
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        console.error('[google-calendar-sync] create failed:', data);
        return json({ error: data?.error?.message || 'Google Calendar rejected the event.' }, 502);
      }
      return json({ eventId: data.id }, 200);
    }

    if (body.action === 'delete') {
      const { eventId } = body;
      if (!eventId) {
        return json({ error: 'Missing eventId.' }, 400);
      }
      const response = await fetch(
        `https://www.googleapis.com/calendar/v3/calendars/primary/events/${eventId}`,
        { method: 'DELETE', headers: { Authorization: `Bearer ${accessToken}` } }
      );
      // 404/410 means the event is already gone (e.g. the client deleted it
      // by hand in their own calendar app) — same "not a real error" call
      // calendarService.js's own deleteCalendarEvent doc comment already
      // made for this exact situation, just enforced server-side here too.
      if (!response.ok && response.status !== 404 && response.status !== 410) {
        const data = await response.json().catch(() => null);
        console.error('[google-calendar-sync] delete failed:', data);
        return json({ error: data?.error?.message || 'Google Calendar rejected the delete.' }, 502);
      }
      return json({ ok: true }, 200);
    }

    return json({ error: 'Unknown action.' }, 400);
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});
