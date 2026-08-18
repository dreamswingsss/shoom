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
// Payment-provider review requirement — Privacy Policy/Terms must be
// reachable from a permanent button in the bot itself, not just linked
// once somewhere. Same two telegra.ph pages ProfileScreen's "Документы и
// поддержка" section links to (src/constants/legal.js) — keep both in
// sync if either URL changes.
const PRIVACY_POLICY_URL = 'https://telegra.ph/Politika-konfidencialnosti-08-18-78';
const TERMS_OF_SERVICE_URL = 'https://telegra.ph/Polzovatelskoe-soglashenie-08-18-25';
const SUPPORT_URL = 'https://t.me/shoom_help';

// Longer than the original one-paragraph pitch on purpose — modeled on
// @sgxplanner_bot's own `/start` reply (mechanism explanation + a bullet
// capability list + Free/Pro line, all before the CTA), which reads as a
// real answer in the chat rather than a single line pushing straight to
// the Mini App. Free-tier numbers here must stay in sync with
// PricingScreen's own free-tier copy (src/locales/ru.json's
// `pricing.tiers.free.features`) and the real caps in
// constants/monetization.js — this is marketing copy of the same facts,
// not a second source of truth for them.
const WELCOME_TEXT =
  '*Shoom — твой личный ИИ-стилист*\n\n' +
  'Это не просто гардероб. Shoom учитывает твой цветотип и форму тела — ' +
  'подскажет, что тебе идёт, а что нет, и что надеть вместо.\n\n' +
  '*Как это работает*\n' +
  'Сфотографируй вещь — Shoom разберёт её и добавит в твой цифровой гардероб. ' +
  'Дальше можно спросить ИИ-стилиста, спланировать образы на неделю или свериться ' +
  'с помощником покупок перед новой вещью.\n\n' +
  '*Что умеет*\n' +
  '— Сканирует вещи и собирает гардероб\n' +
  '— Проверяет вещи по твоему цветотипу\n' +
  '— Советует с учётом формы тела\n' +
  '— ИИ-стилист отвечает на вопросы об образах\n' +
  '— Планировщик: образы на каждый день недели\n' +
  '— Помощник покупок: проверка вещи перед покупкой\n\n' +
  'Free — все разделы открыты: до 15 вещей в гардеробе, 10 сообщений ИИ-стилисту, ' +
  'планирование 2 раза в неделю. Pro снимает все лимиты.\n\n' +
  'Жми кнопку ниже, чтобы начать.';

async function sendMessage(chatId: number, text: string): Promise<void> {
  await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [{ text: 'Войти в приложение', web_app: { url: MINI_APP_URL } }],
          [
            { text: 'Политика конфиденциальности', url: PRIVACY_POLICY_URL },
            { text: 'Соглашение', url: TERMS_OF_SERVICE_URL },
          ],
          [{ text: 'Поддержка', url: SUPPORT_URL }],
        ],
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
