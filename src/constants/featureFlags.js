// Kill switch for the calendar export feature (Google Calendar OAuth +
// universal .ics download — see src/services/googleCalendarService.js,
// src/utils/icsExport.js, and the google-calendar-* Edge Functions).
// Turned off, not deleted: Google blocks the OAuth flow for any account
// not manually allowlisted as a "test user" until the app passes Google's
// own sensitive-scope verification (days-to-weeks, external process, not
// something a code change can skip), and Apple has no OAuth/REST API for
// iCloud Calendar at all — only CalDAV with a manually-generated
// app-specific password, real UX friction for zero users today. Flip this
// back to true once Google verification clears (or a CalDAV path gets
// built) — every UI entry point (ProfileScreen's Calendar row,
// PlannerScreen's/InspirationDetailScreen's Export to Calendar buttons)
// and the underlying services/Edge Functions are still fully wired, just
// not shown.
export const CALENDAR_EXPORT_ENABLED = false;

// Kill switch for the referral program (invite link, bonus wardrobe slots/
// AI messages — see ProfileScreen's "Пригласить друга" row,
// supabase/migrations/0011_referrals.sql, and the referral-crediting logic
// in telegram-bot-webhook/index.ts + telegram-verify/index.ts). Turned off
// at the user's request, not deleted — the DB schema and Edge Function
// logic stay fully wired (harmless when unused: with no link anywhere for
// anyone to click, /start ref_<id> just never fires, and the bonus_*
// columns stay 0 for everyone). Flip back to true to re-show the row.
export const REFERRAL_ENABLED = false;
