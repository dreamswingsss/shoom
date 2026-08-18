// Public endpoint — Google's own redirect hits this directly in the SYSTEM
// browser (no Supabase session/Authorization header available here, unlike
// every other function in this app). Identity comes from `state`, verified
// against the HMAC google-calendar-oauth-start signed it with, not from any
// bearer token.
//
// Deploy: `supabase functions deploy google-calendar-oauth-callback`.
// Requires `GOOGLE_OAUTH_CLIENT_ID` + `GOOGLE_OAUTH_CLIENT_SECRET` — set
// once the user has created a Google Cloud OAuth 2.0 Web application
// client, with this function's own URL registered there as an authorized
// redirect URI:
//   https://<project-ref>.supabase.co/functions/v1/google-calendar-oauth-callback
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const GOOGLE_OAUTH_CLIENT_ID = Deno.env.get('GOOGLE_OAUTH_CLIENT_ID') ?? '';
const GOOGLE_OAUTH_CLIENT_SECRET = Deno.env.get('GOOGLE_OAUTH_CLIENT_SECRET') ?? '';
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const REDIRECT_URI = `${SUPABASE_URL}/functions/v1/google-calendar-oauth-callback`;
// Where the "return to Shoom" link on the result page points — same
// fallback shoom-dusky.vercel.app URL every other function in this app uses
// when the env var isn't set.
const MINI_APP_URL = Deno.env.get('TELEGRAM_MINI_APP_URL') ?? 'https://shoom-dusky.vercel.app';

function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(value: string): Uint8Array {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=');
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

// Returns the verified user id, or null if the signature doesn't match
// (tampered/forged state, or signed with a since-rotated service role key).
async function verifyState(state: string): Promise<string | null> {
  let decoded: string;
  try {
    decoded = new TextDecoder().decode(fromBase64Url(state));
  } catch {
    return null;
  }
  const separatorIndex = decoded.lastIndexOf('.');
  if (separatorIndex === -1) return null;
  const userId = decoded.slice(0, separatorIndex);
  const signatureB64 = decoded.slice(separatorIndex + 1);

  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(SUPABASE_SERVICE_ROLE_KEY),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(userId));
  const expectedB64 = toBase64Url(new Uint8Array(signature));

  return expectedB64 === signatureB64 ? userId : null;
}

function resultPage(title: string, message: string): Response {
  const html = `<!doctype html>
<html lang="ru"><head><meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${title}</title>
<style>
  body { font-family: -apple-system, sans-serif; background: #F2ECE1; color: #1F2235;
    display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; padding: 24px; text-align: center; }
  h1 { font-size: 20px; margin-bottom: 8px; }
  p { color: #474C63; font-size: 15px; margin-bottom: 20px; }
  a { display: inline-block; background: #1F2235; color: #F2ECE1; text-decoration: none;
    font-weight: 700; font-size: 14px; padding: 12px 24px; border-radius: 999px; }
</style></head>
<body><div><h1>${title}</h1><p>${message}</p><a href="${MINI_APP_URL}">Вернуться в Shoom</a></div></body></html>`;
  return new Response(html, { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}

Deno.serve(async (req) => {
  try {
    const url = new URL(req.url);
    const code = url.searchParams.get('code');
    const state = url.searchParams.get('state');
    const oauthError = url.searchParams.get('error');

    if (oauthError) {
      return resultPage('Не удалось подключить календарь', 'Доступ не был предоставлен. Вернитесь в Shoom и попробуйте снова.');
    }
    if (!code || !state) {
      return resultPage('Ссылка недействительна', 'Откройте подключение календаря заново из приложения Shoom.');
    }

    const userId = await verifyState(state);
    if (!userId) {
      return resultPage('Ссылка недействительна', 'Откройте подключение календаря заново из приложения Shoom.');
    }

    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: GOOGLE_OAUTH_CLIENT_ID,
        client_secret: GOOGLE_OAUTH_CLIENT_SECRET,
        redirect_uri: REDIRECT_URI,
        grant_type: 'authorization_code',
      }),
    });
    const tokenData = await tokenResponse.json();
    if (!tokenResponse.ok || !tokenData.access_token || !tokenData.refresh_token) {
      console.error('[google-calendar-oauth-callback] token exchange failed:', tokenData);
      return resultPage('Не удалось подключить календарь', 'Google не подтвердил доступ. Вернитесь в Shoom и попробуйте снова.');
    }

    const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const expiresAt = new Date(Date.now() + tokenData.expires_in * 1000).toISOString();

    const { error: upsertError } = await adminClient.from('google_calendar_tokens').upsert({
      user_id: userId,
      access_token: tokenData.access_token,
      refresh_token: tokenData.refresh_token,
      expires_at: expiresAt,
    });
    if (upsertError) throw upsertError;

    const { error: flagError } = await adminClient
      .from('users')
      .update({ google_calendar_connected: true })
      .eq('id', userId);
    if (flagError) throw flagError;

    return resultPage('Google Calendar подключён', 'Готово, доступ предоставлен.');
  } catch (err) {
    console.error('[google-calendar-oauth-callback]', err);
    return resultPage('Что-то пошло не так', 'Вернитесь в Shoom и попробуйте подключить календарь снова.');
  }
});
