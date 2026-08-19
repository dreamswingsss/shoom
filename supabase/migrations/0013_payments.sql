-- Pro entitlement + payment history — backs the Platega checkout flow
-- (create-payment / platega-webhook Edge Functions). `users.is_pro` is the
-- one flag every paywall gate in the client reads (see useUserStore.js's
-- fetchProfile); `payments` is an audit trail + the row platega-webhook
-- looks up by `platega_transaction_id` when the provider's status callback
-- arrives, since the callback only carries the provider's own transaction
-- id, not our user id.

alter table public.users
  add column is_pro boolean not null default false,
  add column pro_tier text,
  add column pro_expires_at timestamptz;

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  tier text not null,
  amount numeric not null,
  currency text not null default 'RUB',
  -- Platega's own transaction id (returned by POST /v2/transaction/process
  -- as `transactionId`) — what platega-webhook's callback body identifies
  -- the payment by, so this must be unique and is the lookup key there.
  platega_transaction_id uuid not null unique,
  status text not null default 'PENDING',
  created_at timestamptz not null default now(),
  confirmed_at timestamptz
);

comment on table public.payments is 'Platega checkout attempts — one row per created transaction, updated by platega-webhook on status callback.';

alter table public.payments enable row level security;

-- Read-only from the client (their own rows), same "own row" shape as
-- users_select_own in 0001_init.sql — lets PricingScreen poll a payment's
-- status after returning from checkout. No insert/update policy: only
-- create-payment/platega-webhook (service_role, bypasses RLS) ever write here.
create policy "payments_select_own" on public.payments
  for select using (auth.uid() = user_id);
