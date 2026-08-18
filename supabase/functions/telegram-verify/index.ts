// Verifies a Telegram Mini App `initData` string (window.Telegram.WebApp.initData)
// and hands back a Supabase session token — the ONLY place TELEGRAM_BOT_TOKEN
// is used, since the HMAC check below requires it and it must never reach
// the client bundle. Deploy with `supabase functions deploy
// telegram-verify`, secret set via `supabase secrets set
// TELEGRAM_BOT_TOKEN=...`. Invoked from the client via
// `supabase.functions.invoke('telegram-verify', { body: { initData } })`
// — see src/hooks/useTelegramSignIn.js.
//
// This is Mini App `initData` validation, NOT the Telegram Login Widget's
// (different algorithm — see
// https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app):
// secret_key = HMAC_SHA256(key="WebAppData", data=bot_token), then
// hash = HMAC_SHA256(key=secret_key, data=data_check_string).
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const BOT_TOKEN = Deno.env.get('TELEGRAM_BOT_TOKEN') ?? '';
// Bonus wardrobe slots / AI messages credited to BOTH sides of a completed
// referral — kept as a literal here (not an env var) since it's a product
// number, not a secret; mirrored on the client in
// src/constants/monetization.js's REFERRAL_BONUS for the Profile screen's
// own copy. Keep both in sync if this ever changes.
const REFERRAL_BONUS = 3;
// Telegram's own recommendation for how long an initData payload stays
// valid before it should be rejected as stale.
const AUTH_MAX_AGE_SECONDS = 24 * 60 * 60;

// The Mini App is a React Native Web build served from its own origin
// (Vercel/ngrok), not from *.supabase.co — every call here is cross-origin.
// Without these on BOTH the OPTIONS preflight and the real response, the
// browser never surfaces this function's actual JSON body/status to
// supabase-js at all; it fails the fetch itself, which is exactly what
// surfaces client-side as "Failed to send a request to the Edge Function"
// (see useTelegramSignIn.js) regardless of what this function returns.
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

async function hmacSha256(keyBytes: Uint8Array | ArrayBuffer, message: string): Promise<ArrayBuffer> {
  const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
}

function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

// Every field except `hash` itself, sorted, newline-joined — the exact
// data-check-string Telegram's own HMAC is computed over.
function buildDataCheckString(params: URLSearchParams): string {
  const pairs: string[] = [];
  for (const [key, value] of params.entries()) {
    if (key === 'hash') continue;
    pairs.push(`${key}=${value}`);
  }
  return pairs.sort().join('\n');
}

async function computeInitDataHash(botToken: string, dataCheckString: string): Promise<string> {
  const secretKeyBytes = await hmacSha256(new TextEncoder().encode('WebAppData'), botToken);
  const signature = await hmacSha256(secretKeyBytes, dataCheckString);
  return toHex(signature);
}

// Every response (success or error) needs the same CORS headers — a plain
// `{ status }` object like the old code used only sends `Content-Type`,
// which is exactly what left the browser with nothing to authorize the
// response against.
function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req) => {
  // The browser sends this before the real POST on every cross-origin
  // request — must return 2xx with the CORS headers and no body, or the
  // actual POST below never gets sent at all.
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  try {
    if (!BOT_TOKEN) {
      return json({ error: 'TELEGRAM_BOT_TOKEN is not configured.' }, 500);
    }

    const body = await req.json();
    const initData = body?.initData;
    if (!initData || typeof initData !== 'string') {
      return json({ error: 'Missing initData.' }, 400);
    }

    const params = new URLSearchParams(initData);
    const hash = params.get('hash');
    const authDate = params.get('auth_date');
    const userRaw = params.get('user');
    if (!hash || !authDate || !userRaw) {
      return json({ error: 'Missing required initData fields.' }, 400);
    }

    const dataCheckString = buildDataCheckString(params);
    const computedHash = await computeInitDataHash(BOT_TOKEN, dataCheckString);
    if (computedHash !== hash) {
      return json({ error: 'Invalid Telegram signature.' }, 401);
    }

    const authDateSeconds = Number(authDate);
    if (!Number.isFinite(authDateSeconds) || Date.now() / 1000 - authDateSeconds > AUTH_MAX_AGE_SECONDS) {
      return json({ error: 'Telegram login expired, please reopen the app.' }, 401);
    }

    let telegramUser: { id?: number; first_name?: string; last_name?: string; username?: string; photo_url?: string };
    try {
      telegramUser = JSON.parse(userRaw);
    } catch {
      return json({ error: 'Malformed Telegram user data.' }, 400);
    }
    const { id, first_name, last_name, username, photo_url } = telegramUser ?? {};
    if (!id) {
      return json({ error: 'Missing Telegram user id.' }, 400);
    }

    // Admin client — service_role, same pattern as delete-account/index.ts.
    const adminClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    const telegramId = Number(id);
    // auth.users has no native "Telegram id" concept, so this deterministic
    // synthetic email is what ties a Supabase auth identity to a Telegram
    // account across logins — never actually emailed anywhere, just used as
    // the unique key generateLink below signs a token for.
    const email = `tg_${telegramId}@telegram.local`;
    const fullName = [first_name, last_name].filter(Boolean).join(' ') || null;

    const { data: existingProfile, error: lookupError } = await adminClient
      .from('users')
      .select('id')
      .eq('telegram_id', telegramId)
      .maybeSingle();
    if (lookupError) throw lookupError;

    if (!existingProfile) {
      // Fresh auth.users row whose raw_user_meta_data feeds
      // handle_new_auth_user() (0001_init.sql, extended by
      // 0008_telegram_auth.sql) to create the matching public.users row.
      const { error: createError } = await adminClient.auth.admin.createUser({
        email,
        email_confirm: true,
        user_metadata: {
          full_name: fullName,
          avatar_url: photo_url || null,
          telegram_id: telegramId,
          telegram_username: username || null,
        },
      });
      // A second concurrent open of the Mini App for the same brand-new
      // Telegram user can lose the race against the SELECT above —
      // Supabase reports the deterministic email as already registered,
      // which just means the other request already created it; falling
      // through to generateLink for the same email is correct either way.
      // Any other failure is real.
      if (createError && !createError.message?.toLowerCase().includes('already been registered')) {
        throw createError;
      }

      // Referral credit — only for a genuinely brand-new account (this
      // whole branch only runs once per Telegram user, ever). Looks up the
      // pending_referrals row telegram-bot-webhook/index.ts wrote when this
      // same telegram_id sent `/start ref_<code>`; a miss (organic signup,
      // no referral link) is the normal case and just no-ops. Credits BOTH
      // sides (+3 wardrobe slots, +3 chat messages each — see
      // constants/monetization.js's REFERRAL_BONUS_* for the client-side
      // mirror of this number) rather than only the referrer, since a
      // reward on both ends is what actually makes someone tap the link.
      const { data: pendingReferral } = await adminClient
        .from('pending_referrals')
        .select('referrer_telegram_id')
        .eq('telegram_id', telegramId)
        .maybeSingle();

      if (pendingReferral) {
        const { data: newUserRow } = await adminClient
          .from('users')
          .select('id')
          .eq('telegram_id', telegramId)
          .maybeSingle();
        const { data: referrerRow } = await adminClient
          .from('users')
          .select('id, bonus_wardrobe_slots, bonus_chat_messages')
          .eq('telegram_id', pendingReferral.referrer_telegram_id)
          .maybeSingle();

        // Referrer must already have an account (they're the one who sent
        // the link from inside the app) — a pending row whose referrer
        // never actually signed up themselves is stale/unusable, skipped
        // rather than crediting a referred-by relationship to nobody.
        if (newUserRow && referrerRow) {
          await adminClient
            .from('users')
            .update({ referred_by: referrerRow.id, bonus_wardrobe_slots: REFERRAL_BONUS, bonus_chat_messages: REFERRAL_BONUS })
            .eq('id', newUserRow.id);
          await adminClient
            .from('users')
            .update({
              bonus_wardrobe_slots: (referrerRow.bonus_wardrobe_slots || 0) + REFERRAL_BONUS,
              bonus_chat_messages: (referrerRow.bonus_chat_messages || 0) + REFERRAL_BONUS,
            })
            .eq('id', referrerRow.id);
        }

        await adminClient.from('pending_referrals').delete().eq('telegram_id', telegramId);
      }
    } else {
      // Returning client — Telegram's own name/username/photo can have
      // changed since account creation (createUser above only ever runs
      // once), so every login refreshes both auth.users' metadata (what
      // mapSupabaseUser in useSupabaseAuthSync.js actually reads for
      // display) and the public.users mirror columns the creation trigger
      // originally set, keeping them from drifting stale forever after the
      // first login. photo_url is skipped when Telegram didn't send one
      // this time rather than overwriting a previously-known avatar with
      // null — initData omits it for users with no Telegram profile photo,
      // not as a signal that an existing one was removed.
      const { error: updateAuthError } = await adminClient.auth.admin.updateUserById(existingProfile.id, {
        user_metadata: {
          full_name: fullName,
          ...(photo_url ? { avatar_url: photo_url } : {}),
          telegram_id: telegramId,
          telegram_username: username || null,
        },
      });
      if (updateAuthError) throw updateAuthError;

      const { error: updateProfileError } = await adminClient
        .from('users')
        .update({
          display_name: fullName,
          telegram_username: username || null,
          ...(photo_url ? { avatar_url: photo_url } : {}),
        })
        .eq('id', existingProfile.id);
      if (updateProfileError) throw updateProfileError;
    }

    const { data: linkData, error: linkError } = await adminClient.auth.admin.generateLink({
      type: 'magiclink',
      email,
    });
    if (linkError) throw linkError;

    const tokenHash = linkData?.properties?.hashed_token;
    if (!tokenHash) throw new Error('Could not generate a session token.');

    return json({ token_hash: tokenHash }, 200);
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});
