// Creates a Platega checkout link for a Pro tier and returns it to the
// client — the ONLY place PLATEGA_MERCHANT_ID/PLATEGA_SECRET are used, since
// Platega's own transaction-creation call requires them and they must never
// reach the client bundle. Deploy with `supabase functions deploy
// create-payment`, secrets set via `supabase secrets set
// PLATEGA_MERCHANT_ID=... PLATEGA_SECRET=...`. Invoked from the client via
// `supabase.functions.invoke('create-payment', { body: { tier } })` — see
// src/services/paymentService.js.
//
// Uses POST /v2/transaction/process ("create a payment link without a fixed
// method" — the client picks SBP/card/crypto/etc. on Platega's own hosted
// page), not a fixed-paymentMethod request, since PricingScreen has no
// method picker of its own. platega-webhook/index.ts is the other half:
// Platega's async status callback, which is what actually flips
// `users.is_pro` once the customer finishes paying on that hosted page.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const PLATEGA_BASE_URL = 'https://app.platega.io';
const MERCHANT_ID = Deno.env.get('PLATEGA_MERCHANT_ID') ?? '';
const SECRET = Deno.env.get('PLATEGA_SECRET') ?? '';

// Mirrors src/constants/monetization.js's PRICE_PRO_*_RUB constants — kept
// as a literal here (Deno function, can't import from src/) rather than an
// env var since these are product numbers, not secrets. Keep both in sync
// if a price ever changes. founderLifetime has no `months` (never expires;
// platega-webhook leaves `pro_expires_at` null for it).
const TIERS: Record<string, { amountRub: number; description: string; months: number | null }> = {
  proMonthly: { amountRub: 149, description: 'Shoom Pro — 1 месяц', months: 1 },
  proYearly: { amountRub: 1490, description: 'Shoom Pro — 1 год', months: 12 },
  founderLifetime: { amountRub: 2990, description: 'Shoom Pro — Founder Lifetime', months: null },
};

// No dedicated hosted "return to app" page exists yet (the Mini App's own
// bot username isn't configured — see .env's EXPO_PUBLIC_TELEGRAM_BOT_USERNAME
// placeholder), so both point at the support bot link every other part of
// this app already relies on (src/constants/legal.js's SUPPORT_URL) — a
// real, permanently-reachable Telegram link today. PricingScreen doesn't
// depend on either URL's content: it re-checks the payment's actual status
// from `payments` (via platega-webhook) once the client returns, not from
// query params on this redirect.
const RETURN_URL = 'https://t.me/shoom_help';
const FAILED_URL = 'https://t.me/shoom_help';

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

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  try {
    if (!MERCHANT_ID || !SECRET) {
      return json({ error: 'Platega is not configured on the server.' }, 500);
    }

    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return json({ error: 'Missing Authorization header.' }, 401);
    }

    // Same "caller client only identifies who's asking" split as
    // delete-account/index.ts — never used to write anything itself.
    const callerClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } }
    );
    const {
      data: { user },
      error: userError,
    } = await callerClient.auth.getUser();
    if (userError || !user) {
      return json({ error: 'Unauthorized.' }, 401);
    }

    const body = await req.json();
    const tier = body?.tier;
    const tierConfig = typeof tier === 'string' ? TIERS[tier] : undefined;
    if (!tierConfig) {
      return json({ error: `Unknown tier: ${String(tier)}` }, 400);
    }

    const plategaResponse = await fetch(`${PLATEGA_BASE_URL}/v2/transaction/process`, {
      method: 'POST',
      headers: {
        'X-MerchantId': MERCHANT_ID,
        'X-Secret': SECRET,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        paymentDetails: { amount: tierConfig.amountRub, currency: 'RUB' },
        description: tierConfig.description,
        return: RETURN_URL,
        failedUrl: FAILED_URL,
        payload: `tier=${tier};userId=${user.id}`,
        metadata: { userId: user.id, userName: user.email || user.id },
      }),
    });

    if (!plategaResponse.ok) {
      const errText = await plategaResponse.text().catch(() => '');
      return json({ error: `Platega error (${plategaResponse.status}): ${errText}` }, 502);
    }

    const plategaData = await plategaResponse.json();
    const transactionId = plategaData?.transactionId;
    const url = plategaData?.url;
    if (!transactionId || !url) {
      return json({ error: 'Platega response missing transactionId/url.' }, 502);
    }

    // Admin client — the ONLY place SUPABASE_SERVICE_ROLE_KEY is used here,
    // needed since `payments_select_own` (0013_payments.sql) grants the
    // caller's own JWT no INSERT policy at all.
    const adminClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );
    const { error: insertError } = await adminClient.from('payments').insert({
      user_id: user.id,
      tier,
      amount: tierConfig.amountRub,
      currency: 'RUB',
      platega_transaction_id: transactionId,
      status: 'PENDING',
    });
    if (insertError) throw insertError;

    return json({ url, transactionId }, 200);
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});
