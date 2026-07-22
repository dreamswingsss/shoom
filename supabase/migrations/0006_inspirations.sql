-- Lookbook — lets a client bookmark an AI Stylist look (the text verdict +
-- every visual reference shown for it) instead of it disappearing once the
-- chat scrolls past. Mirrors public.clothes's own conventions: owner-scoped
-- RLS, no update policy (a saved look is an immutable snapshot of what the
-- stylist said at that moment, not a row the client edits in place — remove
-- and re-save is the only way to change one).
create table public.inspirations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,

  -- The wardrobe item "Style this item" was launched from, if any — null
  -- for a look built from a plain chat prompt (no single item started it).
  -- on delete set null (not cascade): deleting the source item later
  -- shouldn't take a saved look down with it, it just loses that one
  -- cross-reference.
  base_item_id uuid references public.clothes (id) on delete set null,

  ai_text text not null,

  -- Self-contained snapshot of every visual reference in the look — both
  -- real wardrobe items (`{"type": "wardrobe", "id", "name", "imageUrl"}`)
  -- and AI-suggested new pieces (`{"type": "new", "name", "imageUrl"}`) —
  -- so the Lookbook grid never needs to re-join against the live wardrobe
  -- (which may have since had that item edited or deleted) or re-run the
  -- Unsplash lookup to render a thumbnail.
  generated_items jsonb not null default '[]'::jsonb,

  created_at timestamptz not null default now()
);

create index inspirations_user_id_idx on public.inspirations (user_id);
create index inspirations_base_item_id_idx on public.inspirations (base_item_id);

alter table public.inspirations enable row level security;

create policy "inspirations_select_own" on public.inspirations
  for select using ((select auth.uid()) = user_id);
create policy "inspirations_insert_own" on public.inspirations
  for insert with check ((select auth.uid()) = user_id);
create policy "inspirations_delete_own" on public.inspirations
  for delete using ((select auth.uid()) = user_id);
