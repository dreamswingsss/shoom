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
      const months = TIER_MONTHS[payment.tier] ?? null;
      let proExpiresAt: string | null = null;
      if (months !== null) {
        const { data: userRow, error: userLookupError } = await adminClient
          .from('users')
          .select('pro_expires_at')
          .eq('id', payment.user_id)
          .maybeSingle();
        if (userLookupError) throw userLookupError;

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
    }

    return json({ received: true }, 200);
  } catch (err) {
    // Non-200 here is what makes Platega actually retry (see this file's
    // top comment) — deliberate, unlike create-payment's 500s which just
    // surface to the client.
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});
