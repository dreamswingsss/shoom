-- Per-item measurements — ItemDetailScreen's inline edit panel now lets a
-- client correct not just category/color but the exact cut measurements
-- the AI scan never asked about: length/width/sleeve length for a Top,
-- inseam/leg opening/waist for a pair of Bottoms. One jsonb column, same
-- shape convention public.users.measurements already uses for shoulders/
-- chest/waist/hips — whichever subset of keys applies to the item's
-- category is read/written as one object client-side, so this doesn't need
-- six separate nullable columns most rows would never use.
alter table public.clothes
  add column measurements jsonb not null default '{}'::jsonb;
