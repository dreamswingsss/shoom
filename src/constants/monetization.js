// Freemium limits — the free tier's hard caps, gated everywhere by
// `useUserStore`'s `isPro` flag (`false` until a real subscription/IAP
// integration sets it). One place for these numbers so a store's
// enforcement and a screen's own pre-check (e.g. WardrobeScreen blocking
// the scanner before even opening it) can't drift apart on the actual limit.
export const FREE_WARDROBE_LIMIT = 30;
export const FREE_CHAT_MESSAGE_LIMIT = 20;
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
