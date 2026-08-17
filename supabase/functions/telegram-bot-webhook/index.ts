// Handles Telegram Bot API updates (messages the client sends the bot
// directly in the chat) — separate from telegram-verify, which only ever
// runs INSIDE the Mini App's own WebView. Before this function existed, the
// bot had a Menu Button (opens the Mini App) but no actual message handler,
// which is exactly why `/start` silently did nothing: a Menu Button is a
// persistent UI element, not a command handler — Telegram never sends it
// anywhere as an update. This is what lets the bot answer inside the chat
// itself, Telegram-menu-style, the way @sgxplanner_bot does: a short pitch
// plus a `web_app` button, so the client sees a real reply before ever
// choosing to open the Mini App (instead of the Mini App just opening on
// its own).
//
// Deploy: `supabase functions deploy telegram-bot-webhook`. Then register it
// with Telegram itself (a separate, one-time step — NOT done by this file):
//   curl "https://api.telegram.org/bot<TOKEN>/setWebhook" \
//     -d url=https://<project-ref>.supabase.co/functions/v1/telegram-bot-webhook \
//     -d secret_token=<TELEGRAM_WEBHOOK_SECRET>
// `TELEGRAM_WEBHOOK_SECRET` (this function's own secret, distinct from
// TELEGRAM_BOT_TOKEN) must be set via `supabase secrets set` first and
// passed as `secret_token` above — Telegram echoes it back on every webhook
// POST as the `X-Telegram-Bot-Api-Secret-Token` header, which is what lets
// this function reject requests that didn't actually come from Telegram.
const BOT_TOKEN = Deno.env.get('TELEGRAM_BOT_TOKEN') ?? '';
const WEBHOOK_SECRET = Deno.env.get('TELEGRAM_WEBHOOK_SECRET') ?? '';
const MINI_APP_URL = Deno.env.get('TELEGRAM_MINI_APP_URL') ?? 'https://shoom-dusky.vercel.app';

const WELCOME_TEXT =
  '👗 *Shoom — твой личный ИИ-стилист*\n\n' +
  'Это не просто гардероб. Shoom учитывает твой цветотип и форму тела: ' +
  'подскажет, что тебе идёт, а что нет — и что надеть вместо.\n\n' +
  '• Выбрала вещь не своего цветотипа — предупредим заранее\n' +
  '• Хочешь оверсайз, а фигуре идёт приталенное — подскажем и что взять вместо\n\n' +
  'Нажми кнопку ниже, чтобы начать 👇';

async function sendMessage(chatId: number, text: string): Promise<void> {
  await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [[{ text: '✨ Открыть Shoom', web_app: { url: MINI_APP_URL } }]],
      },
    }),
  });
}

Deno.serve(async (req) => {
  // Telegram doesn't sign webhook bodies — this shared-secret header
  // (set once via setWebhook's own `secret_token` param, see this file's
  // header comment) is the only thing stopping an outsider who finds this
  // URL from POSTing fake Updates that make the bot reply as if a real
  // client had messaged it.
  if (req.headers.get('X-Telegram-Bot-Api-Secret-Token') !== WEBHOOK_SECRET) {
    return new Response('Unauthorized', { status: 401 });
  }

  try {
    const update = await req.json();
    const message = update?.message;
    const chatId = message?.chat?.id;
    // Telegram only retries a webhook that times out or errors — an update
    // shape this function doesn't otherwise handle (edited messages,
    // reactions, chat migrations, group-chat non-command text, etc.) still
    // needs a plain 200 so Telegram doesn't mistake "we chose not to reply"
    // for "delivery failed" and keep resending the same update.
    if (chatId && typeof message?.text === 'string') {
      await sendMessage(chatId, WELCOME_TEXT);
    }
    return new Response('OK', { status: 200 });
  } catch (err) {
    console.error('[telegram-bot-webhook]', err);
    // Still 200 — see the comment above; an update this function failed to
    // parse/handle is not something Telegram redelivering will fix.
    return new Response('OK', { status: 200 });
  }
});
