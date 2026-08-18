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
