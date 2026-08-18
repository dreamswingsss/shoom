// Admin-only: sends a plain-text Telegram DM to every user who has
// notifications_enabled=true (see supabase/migrations/0009_notification_
// preference.sql). Deploy with `supabase functions deploy
// broadcast-notification`, then `supabase secrets set
// ADMIN_TELEGRAM_ID=<numeric id>` — the ONLY id this function will ever
// send on behalf of, checked server-side on every call. Invoked from the
// client via `supabase.functions.invoke('broadcast-notification', { body:
// { message }, headers: { Authorization } })` — see
// src/services/accountService.js's `sendBroadcast`.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const BOT_TOKEN = Deno.env.get('TELEGRAM_BOT_TOKEN') ?? '';
const ADMIN_TELEGRAM_ID = Deno.env.get('ADMIN_TELEGRAM_ID') ?? '';

// Same cross-origin situation as every other Edge Function this Mini App
// calls directly from its web build (telegram-verify/delete-account).
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

// Telegram's own rate limit is ~30 messages/second to distinct chats — this
// app has nowhere near enough users yet to need a real queue, so a plain
// loop with a short pause every BATCH_SIZE sends is enough headroom without
// pulling in job-queue infrastructure for a handful of recipients.
const BATCH_SIZE = 20;
const BATCH_PAUSE_MS = 1000;

async function sendToChat(chatId: number, text: string): Promise<boolean> {
  try {
    const response = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text }),
    });
    return response.ok;
  } catch {
    return false;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  try {
    if (!BOT_TOKEN || !ADMIN_TELEGRAM_ID) {
      return json({ error: 'Broadcast is not configured.' }, 500);
    }

    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return json({ error: 'Missing Authorization header.' }, 401);
    }

    const { message } = await req.json();
    if (!message || typeof message !== 'string' || !message.trim()) {
      return json({ error: 'Missing message.' }, 400);
    }

    // Scoped to the caller's own JWT — used only to find out *who* is
    // asking, same pattern as delete-account/index.ts.
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

    const adminClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    // The caller's OWN telegram_id, looked up server-side — never trust a
    // client-supplied "I am admin" flag. Rejects anyone but the one
    // configured id, including a caller with no telegram_id at all
    // (e.g. a Google-auth account from before Telegram sign-in existed).
    const { data: callerRow, error: callerError } = await adminClient
      .from('users')
      .select('telegram_id')
      .eq('id', user.id)
      .maybeSingle();
    if (callerError) throw callerError;
    if (!callerRow?.telegram_id || String(callerRow.telegram_id) !== ADMIN_TELEGRAM_ID) {
      return json({ error: 'Forbidden.' }, 403);
    }

    const { data: recipients, error: recipientsError } = await adminClient
      .from('users')
      .select('telegram_id')
      .eq('notifications_enabled', true)
      .not('telegram_id', 'is', null);
    if (recipientsError) throw recipientsError;

    let sent = 0;
    let failed = 0;
    const chatIds = (recipients ?? []).map((row) => row.telegram_id as number);

    for (let i = 0; i < chatIds.length; i += BATCH_SIZE) {
      const batch = chatIds.slice(i, i + BATCH_SIZE);
      const results = await Promise.all(batch.map((chatId) => sendToChat(chatId, message)));
      for (const ok of results) {
        if (ok) sent += 1;
        else failed += 1;
      }
      if (i + BATCH_SIZE < chatIds.length) await sleep(BATCH_PAUSE_MS);
    }

    return json({ sent, failed }, 200);
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});
