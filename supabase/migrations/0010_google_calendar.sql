-- Real Google Calendar OAuth connection (replaces the expo-calendar path,
-- which has zero web support and this app runs exclusively as web inside
-- Telegram — see supabase/functions/google-calendar-oauth-callback and
-- google-calendar-sync for the Edge Functions that read/write this).

-- Tokens — service-role-only, no client policy at all (same "server-written,
-- never client-touched" shape as this table needs: nothing here should ever
-- be readable from the client, unlike users/clothes/outfits above).
create table public.google_calendar_tokens (
  user_id uuid primary key references public.users (id) on delete cascade,
  access_token text not null,
  refresh_token text not null,
  expires_at timestamptz not null,
  updated_at timestamptz not null default now()
);

create trigger google_calendar_tokens_set_updated_at
  before update on public.google_calendar_tokens
  for each row execute function public.set_updated_at();

alter table public.google_calendar_tokens enable row level security;
-- No policies — RLS enabled with zero policies denies all client access by
-- default; only the service-role key (used by the Edge Functions) bypasses
-- RLS entirely, which is exactly the "server-only" boundary this table needs.

-- Client-readable connection flag — lets ProfileScreen show "подключён" /
-- "не подключён" without ever querying google_calendar_tokens directly.
-- Existing users_select_own policy (0001_init.sql) already covers reading
-- this; no new policy needed.
alter table public.users
  add column google_calendar_connected boolean not null default false;
