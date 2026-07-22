-- Smart AI Style Advisor (see the feature's PRD) — adds the garment-cut
-- attribute the color+cut rule engine needs (src/utils/styleAdvisor.js), plus
-- the verdict computed once at scan time (ScanSheet), cached here so
-- ItemDetailScreen can show a passive badge without re-running the advisor
-- (a fresh rule-check is cheap, but advisor_message came from a Gemini call —
-- that should only ever happen once per item, not on every card view).
alter table public.clothes
  add column cut text,
  add column advisor_color_match text check (advisor_color_match in ('perfect', 'neutral', 'avoid')),
  add column advisor_cut_match text check (advisor_cut_match in ('perfect', 'neutral', 'avoid')),
  add column advisor_message text;
