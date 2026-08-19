// Platega's async payment-status callback — the other half of
// create-payment/index.ts. Configure this function's URL in Platega's
// dashboard (Настройки → Callback URLs); deploy with `supabase functions
// deploy platega-webhook --no-verify-jwt` (this is called by Platega's
// servers, not a signed-in client, so Supabase's own JWT check must be
// off — auth here is Platega's X-MerchantId/X-Secret headers instead, see
// below).
//
// Per Platega's docs this callback carries NO request signature — identity
// is established purely by the same X-MerchantId/X-Secret pair used to
// authenticate OUR outgoing calls, sent back on THEIR incoming one. Reject
// anything that doesn't match exactly.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const MERCHANT_ID = Deno.env.get('PLATEGA_MERCHANT_ID') ?? '';
const SECRET = Deno.env.get('PLATEGA_SECRET') ?? '';

// Mirrors create-payment/index.ts's TIERS map — only the renewal length is
// needed here (price/description live there, not needed to credit a
// purchase). Keep both in sync if a tier's length ever changes.
const TIER_MONTHS: Record<string, number | null> = {
  proMonthly: 1,
  proYearly: 12,
  founderLifetime: null,
};

// Display name for the "Pro activated" Telegram DM below — mirrors
// src/locales/ru.json's `pricing.tiers.<key>.name` (kept as a plain literal
// here, same reasoning as TIER_MONTHS: this is a Deno function, can't
// import client i18n resources).
const TIER_LABELS: Record<string, string> = {
  proMonthly: 'Pro · месяц',
  proYearly: 'Pro · год',
  founderLifetime: 'Founder Lifetime',
};

const BOT_TOKEN = Deno.env.get('TELEGRAM_BOT_TOKEN') ?? '';

// Best-effort "subscription activated" DM, reusing telegram-verify's own
// pattern of treating the bot as this Mini App's real notification channel
// (there's no native push infrastructure wired up — see
// src/utils/notifications.js). Deliberately NOT gated on
// `users.notifications_enabled`: that flag is the marketing/broadcast
// opt-out (see broadcast-notification/index.ts), and this is a
// transactional purchase receipt, not a broadcast. Never thrown from —
// a Telegram API hiccup should never turn a successful, already-committed
// payment into a 500 that makes Platega retry a callback that already did
// its real job.
async function sendProActivatedDm(telegramId: number, tier: string, proExpiresAt: string | null) {
  if (!BOT_TOKEN) return;

  const tierLabel = TIER_LABELS[tier] ?? tier;
  const expiryLine = proExpiresAt
    ? `\nДействует до ${new Date(proExpiresAt).toLocaleDateString('ru-RU')}.`
    : '';
  const text =
    `Подписка Shoom Pro активирована! Тариф: ${tierLabel}.${expiryLine}\n\n` +
    'Теперь доступно: безлимитный гардероб, безлимитный чат со стилистом, ' +
    'помощник покупок в примерочной и полное планирование недели.';

  try {
    await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: telegramId, text }),
    });
  } catch (err) {
    console.log('platega-webhook: sendProActivatedDm failed:', err);
  }
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return json({ error: 'Method not allowed.' }, 405);
  }

  try {
    if (!MERCHANT_ID || !SECRET) {
      return json({ error: 'Platega is not configured on the server.' }, 500);
    }

    // Platega's own auth for this callback — see this file's top comment.
    // Checked before touching the body at all.
    if (req.headers.get('X-MerchantId') !== MERCHANT_ID || req.headers.get('X-Secret') !== SECRET) {
      return json({ error: 'Unauthorized.' }, 401);
    }

    const body = await req.json();
    const transactionId = body?.id;
    const status = body?.status;
    if (!transactionId || !status) {
      return json({ error: 'Missing id/status.' }, 400);
    }
    // Only these two are ever sent per CallbackPayload — anything else
    // (a status this integration doesn't otherwise expect) is logged and
    // acknowledged rather than retried forever, since it isn't ours to fix.
    if (status !== 'CONFIRMED' && status !== 'CANCELED') {
      console.log(`platega-webhook: ignoring unhandled status "${status}" for ${transactionId}`);
      return json({ received: true }, 200);
    }

    const adminClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    const { data: payment, error: paymentError } = await adminClient
      .from('payments')
      .select('id, user_id, tier, status')
      .eq('platega_transaction_id', transactionId)
      .maybeSingle();
    if (paymentError) throw paymentError;
    if (!payment) {
      // A transaction we never created (or already deleted) — nothing to
      // credit. Still 200s: retrying won't make it exist.
      return json({ received: true }, 200);
    }

    // Idempotent — Platega retries up to 3x on a non-200, and could plausibly
    // resend a CONFIRMED it already got a 200 for. Re-crediting on a second
    // delivery would double-extend `pro_expires_at`.
    if (payment.status === 'CONFIRMED' || payment.status === 'CANCELED') {
      return json({ received: true }, 200);
    }

    const { error: updatePaymentError } = await adminClient
      .from('payments')
      .update({ status, confirmed_at: status === 'CONFIRMED' ? new Date().toISOString() : null })
      .eq('id', payment.id);
    if (updatePaymentError) throw updatePaymentError;

    if (status === 'CONFIRMED') {
      // Fetched unconditionally (not just when the tier has an expiry) —
      // telegram_id is needed either way for sendProActivatedDm below.
      const { data: userRow, error: userLookupError } = await adminClient
        .from('users')
        .select('pro_expires_at, telegram_id')
        .eq('id', payment.user_id)
        .maybeSingle();
      if (userLookupError) throw userLookupError;

      const months = TIER_MONTHS[payment.tier] ?? null;
      let proExpiresAt: string | null = null;
      if (months !== null) {
        // Renewing before the current period ends extends from the existing
        // expiry, not from today — buying another year with 3 months still
        // left shouldn't waste them.
        const currentExpiry = userRow?.pro_expires_at ? new Date(userRow.pro_expires_at) : null;
        const base = currentExpiry && currentExpiry.getTime() > Date.now() ? currentExpiry : new Date();
        base.setMonth(base.getMonth() + months);
        proExpiresAt = base.toISOString();
      }

      const { error: updateUserError } = await adminClient
        .from('users')
        .update({ is_pro: true, pro_tier: payment.tier, pro_expires_at: proExpiresAt })
        .eq('id', payment.user_id);
      if (updateUserError) throw updateUserError;

      // Guest/never-Telegram-linked accounts have no telegram_id — no DM
      // channel to use, silently skipped rather than erroring.
      if (userRow?.telegram_id) {
        await sendProActivatedDm(userRow.telegram_id, payment.tier, proExpiresAt);
      }
    }

    return json({ received: true }, 200);
  } catch (err) {
    // Non-200 here is what makes Platega actually retry (see this file's
    // top comment) — deliberate, unlike create-payment's 500s which just
    // surface to the client.
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});
