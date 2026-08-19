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
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

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
// Served statically from the Expo web build's `public/` folder (copied
// there from assets/brand/shoom-wordmark.png — same file, kept in both
// places since `public/` is what Vercel actually serves at this URL, and
// `assets/` is what the rest of the app's own asset pipeline expects
// brand files to live under). Telegram's sendPhoto needs a URL it can
// fetch itself, not a local file upload.
const WORDMARK_PHOTO_URL = `${MINI_APP_URL}/brand/shoom-wordmark.png`;

// Longer than the original one-paragraph pitch on purpose — modeled on
// @sgxplanner_bot's own `/start` reply (mechanism explanation + a bullet
// capability list, all before the CTA), which reads as a real answer in
// the chat rather than a single line pushing straight to the Mini App.
// No Free/Pro pricing line here (dropped per the user's own rewrite) —
// PricingScreen's own free-tier copy (src/locales/ru.json's
// `pricing.tiers.free.features`) is where that lives now.
const WELCOME_TEXT =
  '*Shoom - твой личный стилист*\n\n' +
  'Это не просто гардероб. Shoom учитывает твой цветотип и форму тела - ' +
  'подскажет, что тебе идёт, а что нужно поменять.\n\n' +
  '*Как это работает*\n' +
  'Сфотографируй вещь - Shoom разберёт её и добавит в твой цифровой гардероб. ' +
  'Дальше можно спросить ИИ-стилиста, спланировать образы на неделю или посоветоваться ' +
  'с помощником покупок перед новой вещью.\n\n' +
  '*Что умеет*\n' +
  '• Сканирует вещи и собирает гардероб\n' +
  '• Проверяет вещи по твоему цветотипу\n' +
  '• Советует с учётом формы тела\n' +
  '• ИИ-стилист отвечает на вопросы об образах\n' +
  '• Планировщик: образы на каждый день недели\n' +
  '• Помощник покупок: проверка вещи перед покупкой\n\n' +
  'Жми кнопку ниже, чтобы начать.';

// Photo + caption (not a plain text message) — the wordmark renders above
// the pitch text in the chat, same "image first, text below" shape as the
// reference bot this whole /start flow is modeled on. WELCOME_TEXT (653
// chars at last count) must stay under Telegram's 1024-char caption cap
// for sendPhoto — sendMessage's own 4096-char cap doesn't apply here.
async function sendWelcomePhoto(chatId: number, caption: string): Promise<void> {
  await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendPhoto`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      photo: WORDMARK_PHOTO_URL,
      caption,
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
    const senderId = message?.from?.id;
    // Telegram only retries a webhook that times out or errors — an update
    // shape this function doesn't otherwise handle (edited messages,
    // reactions, chat migrations, group-chat non-command text, etc.) still
    // needs a plain 200 so Telegram doesn't mistake "we chose not to reply"
    // for "delivery failed" and keep resending the same update.
    if (chatId && typeof message?.text === 'string') {
      // Referral link is `/start ref_<referrer's telegram_id>` — logged
      // here (the bot side, which sees every /start regardless of whether
      // the client ever opens the Mini App) rather than only in the Mini
      // App itself, since a client who clicks the link but never signs in
      // would otherwise leave no trace of the referral at all.
      // telegram-verify/index.ts is what actually credits both accounts,
      // once/if this same telegram_id completes a real sign-in — this row
      // is just "someone with this id was referred by this other id",
      // consumed and deleted there.
      const referralMatch = message.text.match(/^\/start ref_(\d+)/);
      if (referralMatch && senderId) {
        const referrerTelegramId = Number(referralMatch[1]);
        if (referrerTelegramId !== senderId) {
          const adminClient = createClient(
            Deno.env.get('SUPABASE_URL')!,
            Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
          );
          const { error: referralError } = await adminClient
            .from('pending_referrals')
            .upsert({ telegram_id: senderId, referrer_telegram_id: referrerTelegramId });
          if (referralError) console.error('[telegram-bot-webhook] pending_referrals upsert failed:', referralError);
        }
      }

      await sendWelcomePhoto(chatId, WELCOME_TEXT);
    }
    return new Response('OK', { status: 200 });
  } catch (err) {
    console.error('[telegram-bot-webhook]', err);
    // Still 200 — see the comment above; an update this function failed to
    // parse/handle is not something Telegram redelivering will fix.
    return new Response('OK', { status: 200 });
  }
});
