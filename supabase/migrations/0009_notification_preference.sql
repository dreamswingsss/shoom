-- App-level "send me messages" preference, gating broadcast-notification's
-- (supabase/functions/broadcast-notification/index.ts) recipient list.
-- Defaults true (opt-out, not opt-in) since anyone who opened the bot can
-- already be DMed by it — this just lets them turn that off.
alter table public.users
  add column notifications_enabled boolean not null default true;
