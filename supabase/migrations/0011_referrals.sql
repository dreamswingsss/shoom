-- Referral program — extends free-tier limits per successful invite instead
-- of giving Pro away outright, and doubles as a free acquisition channel
-- (see telegram-bot-webhook/index.ts's /start ref_<telegram_id> handling
-- and telegram-verify/index.ts's credit-on-signup logic). Referral "code"
-- is just the referrer's own telegram_id — already unique, no separate
-- code/column needed.

alter table public.users
  add column referred_by uuid references public.users(id),
  add column bonus_wardrobe_slots integer not null default 0,
  add column bonus_chat_messages integer not null default 0;

-- Bridges the gap between "someone clicked a referral link and messaged the
-- bot" (telegram-bot-webhook, which only ever sees the Telegram side, no
-- Supabase session yet) and "that same person actually signed into the Mini
-- App" (telegram-verify, which creates the public.users row and is the only
-- place that can credit both accounts). One row per pending invite, deleted
-- once telegram-verify consumes it. Service-role-only — same "no client
-- policy at all" shape as google_calendar_tokens (0010_google_calendar.sql):
-- nothing here should ever be readable or writable from the client.
create table public.pending_referrals (
  telegram_id bigint primary key,
  referrer_telegram_id bigint not null,
  created_at timestamptz not null default now()
);

alter table public.pending_referrals enable row level security;
