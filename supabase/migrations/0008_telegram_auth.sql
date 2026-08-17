-- ============================================================================
-- Telegram sign-in — additive columns + trigger update. Auth still goes
-- through Supabase's built-in auth.users; a Telegram login just creates an
-- auth.users row with a synthetic email (tg_<id>@telegram.local) via the
-- telegram-verify Edge Function's admin.createUser call, same as Google
-- sign-in does today (see handle_new_auth_user() below). Nothing here
-- touches the Google path — telegram_id/telegram_username are simply absent
-- from raw_user_meta_data for a Google signup, so the coalesced inserts are
-- no-ops (null) for those rows.
-- ============================================================================

alter table public.users
  add column telegram_id bigint unique,
  add column telegram_username text;

create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.users (id, email, display_name, avatar_url, telegram_id, telegram_username)
  values (
    new.id,
    new.email,
    new.raw_user_meta_data ->> 'full_name',
    new.raw_user_meta_data ->> 'avatar_url',
    nullif(new.raw_user_meta_data ->> 'telegram_id', '')::bigint,
    new.raw_user_meta_data ->> 'telegram_username'
  );
  return new;
end;
$$;
