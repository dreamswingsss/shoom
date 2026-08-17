-- Body Measurements onboarding step's cm/in toggle (RegistrationFlow.js) —
-- tags which unit system the raw shoulders/chest/waist/hips numbers in
-- `measurements` were entered in, so the AI stylist prompt (and any future
-- real cm<->in conversion) knows how to interpret them. Display-only toggle
-- for now, same as the height/weight step's own unitSystem (src/constants/
-- profileOptions.js already has feetInchesToCm/lbsToKg helpers waiting for
-- that follow-up work) — no conversion happens on entry, this column just
-- records which system was active when the numbers were typed.
alter table public.users
  add column measurement_unit text not null default 'cm' check (measurement_unit in ('cm', 'in'));
