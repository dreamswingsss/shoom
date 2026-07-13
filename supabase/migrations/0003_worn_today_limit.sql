-- Limits "I'm wearing this today" to once per local calendar day, per item.
-- Previously increment_worn_count() had no such guard — the client could
-- tap it repeatedly and inflate worn_count arbitrarily.

alter table public.clothes
  add column last_worn_date date;

-- Signature is changing (one arg -> two), so the old single-arg overload
-- has to be dropped explicitly — `create or replace` alone would leave it
-- behind as a second, now-unused overload instead of replacing it.
drop function if exists public.increment_worn_count(uuid);

-- Returns true if the count was actually bumped, false if this item was
-- already logged for `local_date`. Deliberately a boolean return rather
-- than raising an exception — "already worn today" is an expected, common
-- outcome (the client normally guards against it too, see
-- useWardrobeStore.js), not an error condition.
--
-- `local_date` is supplied by the CLIENT, not computed here via now()/
-- current_date — those are UTC-anchored and would roll the day over at the
-- wrong moment for any client not on UTC. The client is the one place that
-- actually knows the user's local calendar day.
create or replace function public.increment_worn_count(item_id uuid, local_date date)
returns boolean
language plpgsql
security invoker
as $$
declare
  current_last_worn date;
begin
  select last_worn_date into current_last_worn
  from public.clothes
  where id = item_id;

  -- `is not distinct from` (rather than `=`) so this compares correctly
  -- even when current_last_worn is null (never worn) — plain `=` against
  -- null evaluates to null/false either way here, but this makes the
  -- null-handling explicit instead of relying on that.
  if current_last_worn is not distinct from local_date then
    return false;
  end if;

  update public.clothes
  set worn_count = worn_count + 1,
      last_worn_date = local_date
  where id = item_id;

  return true;
end;
$$;
