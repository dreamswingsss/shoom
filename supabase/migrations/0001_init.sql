-- ============================================================================
-- Initial schema for the migration off AsyncStorage.
--
-- Auth stays on Supabase's built-in `auth.users` (Google OAuth via
-- supabase.auth.signInWithIdToken — see AuthScreen migration note in the
-- chat response). `public.users` below is a 1:1 PROFILE extension table,
-- not a second auth system: its primary key IS the auth.users id.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. public.users — Fit Profile (mirrors useUserStore.js's profile fields)
-- ----------------------------------------------------------------------------
create table public.users (
  id uuid primary key references auth.users (id) on delete cascade,
  email text,
  display_name text,
  avatar_url text,

  -- Fit Profile
  gender text,
  hair_color text,
  eye_color text,
  skin_tone text,
  body_type text,
  height_cm numeric,
  weight_kg numeric,
  -- { shoulders, chest, waist, hips } — kept as jsonb rather than 4 columns
  -- since it's read/written as one object everywhere in the client already.
  measurements jsonb not null default '{}'::jsonb,
  style_preferences text,
  style_vibes text[] not null default '{}',

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.users is 'Fit Profile — 1:1 extension of auth.users, not a separate auth table.';

-- Keeps `updated_at` honest on every UPDATE without every call site having
-- to remember to set it manually.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger users_set_updated_at
  before update on public.users
  for each row execute function public.set_updated_at();

-- Auto-provisions a `public.users` row the moment someone completes Google
-- sign-in — mirrors what AuthScreen.js's login() already does today (name/
-- email/photo captured at first sign-in), so the client never has to run a
-- separate "create profile" INSERT after auth.
create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.users (id, email, display_name, avatar_url)
  values (
    new.id,
    new.email,
    new.raw_user_meta_data ->> 'full_name',
    new.raw_user_meta_data ->> 'avatar_url'
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_auth_user();

-- ----------------------------------------------------------------------------
-- 2. public.clothes — the digital closet (WardrobeScreen / WardrobeCatalogScreen)
-- ----------------------------------------------------------------------------
create table public.clothes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,

  -- Storage OBJECT PATH ("{user_id}/{uuid}.jpg"), not a signed/public URL —
  -- URLs are derived client-side via getPublicUrl(). See Part 2 (Storage).
  image_path text not null,

  category text not null check (
    category in ('Tops', 'Bottoms', 'Outerwear', 'Shoes', 'Accessories', 'Bags')
  ),
  subcategory text not null,
  color text not null,
  style text,
  description text,

  -- Cost Per Wear — bumped via the increment_worn_count() RPC below, never
  -- a plain client-side UPDATE (see Part 3 for why).
  worn_count integer not null default 0 check (worn_count >= 0),

  created_at timestamptz not null default now()
);

create index clothes_user_id_idx on public.clothes (user_id);

-- Atomic increment — a naive `update ... set worn_count = worn_count + 1`
-- from the client is still fine as a single statement, but exposing it as
-- an RPC lets the DB (not app code on N devices) own the read-modify-write,
-- and is where you'd add e.g. a "worn today" dedupe check later.
create or replace function public.increment_worn_count(clothes_id uuid)
returns void
language sql
security invoker
as $$
  update public.clothes
  set worn_count = worn_count + 1
  where id = clothes_id;
$$;

-- ----------------------------------------------------------------------------
-- 3. public.outfits + public.outfit_items — saved/planned looks
--    (mirrors usePlannerStore.js's scheduledOutfits[dateKey])
--
--    outfit_ids was a plain array in AsyncStorage; Postgres can't put a real
--    foreign key on the elements of an array column, so it's normalized into
--    a join table here instead — that's what actually gives us the "don't
--    forget the Foreign Keys" referential integrity for saved looks.
-- ----------------------------------------------------------------------------
create table public.outfits (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  scheduled_date date not null,
  -- AI-suggested items NOT yet in the closet (no clothes.id to reference) —
  -- kept as jsonb, same shape as the client's `newItems` array today.
  new_items jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),

  -- Matches scheduledOutfits[dateKey] semantics: one saved look per day.
  unique (user_id, scheduled_date)
);

create table public.outfit_items (
  outfit_id uuid not null references public.outfits (id) on delete cascade,
  clothes_id uuid not null references public.clothes (id) on delete cascade,
  primary key (outfit_id, clothes_id)
);

create index outfits_user_id_idx on public.outfits (user_id);
create index outfit_items_clothes_id_idx on public.outfit_items (clothes_id);

-- ----------------------------------------------------------------------------
-- 4. Row Level Security — every table, own-rows-only.
--    Wrapping auth.uid() in `(select ...)` is the Supabase-recommended form:
--    it lets Postgres cache the value once per statement instead of
--    re-evaluating it per row.
-- ----------------------------------------------------------------------------
alter table public.users enable row level security;
alter table public.clothes enable row level security;
alter table public.outfits enable row level security;
alter table public.outfit_items enable row level security;

create policy "users_select_own" on public.users
  for select using ((select auth.uid()) = id);
create policy "users_update_own" on public.users
  for update using ((select auth.uid()) = id);
-- No insert/delete policy for `users`: rows are created by the
-- handle_new_auth_user() trigger (security definer) and removed by the
-- Delete Account Edge Function via auth.admin.deleteUser() cascade — never
-- directly by the client.

create policy "clothes_select_own" on public.clothes
  for select using ((select auth.uid()) = user_id);
create policy "clothes_insert_own" on public.clothes
  for insert with check ((select auth.uid()) = user_id);
create policy "clothes_update_own" on public.clothes
  for update using ((select auth.uid()) = user_id);
create policy "clothes_delete_own" on public.clothes
  for delete using ((select auth.uid()) = user_id);

create policy "outfits_select_own" on public.outfits
  for select using ((select auth.uid()) = user_id);
create policy "outfits_insert_own" on public.outfits
  for insert with check ((select auth.uid()) = user_id);
create policy "outfits_update_own" on public.outfits
  for update using ((select auth.uid()) = user_id);
create policy "outfits_delete_own" on public.outfits
  for delete using ((select auth.uid()) = user_id);

-- outfit_items has no user_id of its own — ownership is proven by joining
-- back to the parent outfit.
create policy "outfit_items_select_own" on public.outfit_items
  for select using (
    exists (
      select 1 from public.outfits o
      where o.id = outfit_items.outfit_id and o.user_id = (select auth.uid())
    )
  );
create policy "outfit_items_insert_own" on public.outfit_items
  for insert with check (
    exists (
      select 1 from public.outfits o
      where o.id = outfit_items.outfit_id and o.user_id = (select auth.uid())
    )
  );
create policy "outfit_items_delete_own" on public.outfit_items
  for delete using (
    exists (
      select 1 from public.outfits o
      where o.id = outfit_items.outfit_id and o.user_id = (select auth.uid())
    )
  );

-- ----------------------------------------------------------------------------
-- 5. Storage — bucket + per-user-folder policies (see Part 2 for the "why").
-- ----------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('clothes-photos', 'clothes-photos', true)
on conflict (id) do nothing;

-- Public bucket = SELECT is open to anyone with the (unguessable, UUID-
-- named) URL — that's what makes getPublicUrl() work with zero client
-- complexity. Write access is still locked to the owning user's own
-- "{user_id}/..." folder, same convention clothes.image_path uses.
create policy "clothes_photos_public_read" on storage.objects
  for select using (bucket_id = 'clothes-photos');

create policy "clothes_photos_insert_own_folder" on storage.objects
  for insert with check (
    bucket_id = 'clothes-photos'
    and (select auth.uid()::text) = (storage.foldername(name))[1]
  );

create policy "clothes_photos_delete_own_folder" on storage.objects
  for delete using (
    bucket_id = 'clothes-photos'
    and (select auth.uid()::text) = (storage.foldername(name))[1]
  );
