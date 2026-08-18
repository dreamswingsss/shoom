// Authenticated: builds the Google consent URL for the calling user and
// hands it back so the client can open it in the SYSTEM browser (Telegram
// Mini Apps can't navigate their own sandboxed WebView to an external
// domain — see src/services/googleCalendarService.js's
// `window.Telegram?.WebApp?.openLink` call).
//
// `state` is a signed, stateless token (base64url(user_id + '.' +
// HMAC_SHA256(user_id, SUPABASE_SERVICE_ROLE_KEY))) rather than a row in a
// new table — google-calendar-oauth-callback verifies the HMAC instead of
// looking anything up, so there's no expiry-cleanup job needed for a
// short-lived, single-use value nobody else ever has to read.
//
// Deploy: `supabase functions deploy google-calendar-oauth-start`. Requires
// `GOOGLE_OAUTH_CLIENT_ID` (see `supabase secrets set`) — set once the user
// has created a Google Cloud OAuth 2.0 Web application client.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const GOOGLE_OAUTH_CLIENT_ID = Deno.env.get('GOOGLE_OAUTH_CLIENT_ID') ?? '';
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
// Same project ref the other functions in this file's family deploy under —
// this IS google-calendar-oauth-callback's own URL, not configurable
// separately, so there's nothing to keep in sync by hand.
const REDIRECT_URI = `${SUPABASE_URL}/functions/v1/google-calendar-oauth-callback`;

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

function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function signState(userId: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(SUPABASE_SERVICE_ROLE_KEY),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(userId));
  const signatureB64 = toBase64Url(new Uint8Array(signature));
  return toBase64Url(new TextEncoder().encode(`${userId}.${signatureB64}`));
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  try {
    if (!GOOGLE_OAUTH_CLIENT_ID) {
      return json({ error: 'Google Calendar is not configured.' }, 500);
    }

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

    const state = await signState(user.id);
    const params = new URLSearchParams({
      client_id: GOOGLE_OAUTH_CLIENT_ID,
      redirect_uri: REDIRECT_URI,
      response_type: 'code',
      // Least-privilege — only what create/delete event calls actually use,
      // not full calendar read/write.
      scope: 'https://www.googleapis.com/auth/calendar.events',
      access_type: 'offline',
      // Forces Google to hand back a refresh_token on EVERY consent, not
      // just the client's very first one — without this, a client who
      // disconnects and reconnects would silently get an access-only grant.
      prompt: 'consent',
      state,
    });

    return json({ url: `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}` }, 200);
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});
