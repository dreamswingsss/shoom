// Freemium limits — the free tier's hard caps, gated everywhere by
// `useUserStore`'s `isPro` flag (`false` until a real subscription/IAP
// integration sets it). One place for these numbers so a store's
// enforcement and a screen's own pre-check (e.g. WardrobeScreen blocking
// the scanner before even opening it) can't drift apart on the actual limit.
export const FREE_WARDROBE_LIMIT = 15;
export const FREE_CHAT_MESSAGE_LIMIT = 10;
// Max number of DAYS (any days, anywhere in the week — not "today and
// tomorrow" specifically) a free-tier client can have an outfit scheduled
// on at once. Every day pill in PlannerScreen's week row is clickable
// regardless of tier; this caps how many of them can actually hold a plan,
// checked against usePlannerStore's own getPlannedDaysCount(scheduledOutfits)
// both in PlannerScreen's own pre-check and in scheduleOutfit's real
// backstop (see that action's own comment — StylistScreen's Save-to-Planner
// modal is the other path that can create a new planned day, so the backstop
// is what actually enforces this regardless of which screen the request
// came from).
export const FREE_PLANNED_DAYS_LIMIT = 2;

// Real prices, in RUB — the single source of truth PricingScreen renders
// from. Copy (tier names, feature bullets) lives in ru.json's `pricing`
// namespace since it's display text, not a business number; these three
// stay here so the actual RUB amount is never duplicated as a second
// literal anywhere it's shown.
// TEMPORARY — 10 RUB for a live end-to-end payment test (real card/SBP
// purchase through Platega, not a stub). Revert to 149 the moment that
// test is done — this is the real production price every client sees on
// PricingScreen, not a hidden/dev-only value.
export const PRICE_PRO_MONTHLY_RUB = 10;
export const PRICE_PRO_YEARLY_RUB = 1490;
export const PRICE_FOUNDER_LIFETIME_RUB = 2990;

// Bonus wardrobe slots / AI messages credited to BOTH sides of a completed
// referral (see supabase/functions/telegram-verify/index.ts's own
// REFERRAL_BONUS — that's the value that actually gets written to the DB;
// this is only the client-side copy of the same number, for ProfileScreen's
// "Пригласить друга" row). Keep both in sync if this ever changes.
export const REFERRAL_BONUS = 3;
