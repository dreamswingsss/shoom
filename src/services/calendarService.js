// Pro-only "Export to Calendar" — writes a real event onto the device's own
// Apple/Google Calendar for a saved Lookbook look, via expo-calendar. Kept
// as its own service (not inline in InspirationDetailScreen) the same way
// aiChatEngine/gemini.js split request-building from the low-level client —
// the screen owns paywall/permission-denied UI, this owns the actual device
// API calls and their platform quirks.
import { Platform } from 'react-native';
import * as Calendar from 'expo-calendar';

const EVENT_TITLE = 'Shoom Outfit';
const EVENT_DURATION_MS = 60 * 60 * 1000;
// Fixed local time for the event — the export flow only ever asks the
// client to pick a DAY (see InspirationDetailScreen's own day-picker, the
// same 7-day-window shape StylistScreen's Save-to-Planner button already
// uses), not a time, so every exported look lands as a 9am reminder on
// whatever day they chose rather than needing a full time picker UI.
const EVENT_HOUR = 9;

// Thrown instead of ever calling into expo-calendar on web — this app ships
// a real web target, and `expo-calendar` has no web implementation at all
// (unlike e.g. expo-image-picker, which degrades to a file input there).
// A distinct class (same pattern as gemini.js's GeminiRateLimitError /
// GeminiLocationRestrictedError) rather than a plain Error string lets the
// screen give this its own translated copy instead of showing whatever
// message happens to be attached.
export class CalendarWebUnavailableError extends Error {
  constructor() {
    super('Calendar export is not available on Web.');
    this.name = 'CalendarWebUnavailableError';
  }
}

// Thrown when the client declines (or has previously permanently declined)
// the calendar permission prompt. `canAskAgain` rides along so the screen
// can tell "the OS will still let us ask again next time" apart from "this
// is blocked until they flip it on in Settings themselves" — iOS/Android
// both report this via the same PermissionResponse shape
// (requestCalendarPermissionsAsync's own return value), so no per-platform
// branching is needed here to surface it.
export class CalendarPermissionDeniedError extends Error {
  constructor(canAskAgain) {
    super('Calendar permission was not granted.');
    this.name = 'CalendarPermissionDeniedError';
    this.canAskAgain = canAskAgain;
  }
}

// Shared by every entry point below — requesting an already-granted
// permission is a cheap no-op, so this just runs unconditionally rather
// than each caller tracking whether some earlier call already asked.
async function ensureCalendarPermission() {
  if (Platform.OS === 'web') {
    throw new CalendarWebUnavailableError();
  }
  const { status, canAskAgain } = await Calendar.requestCalendarPermissionsAsync();
  if (status !== 'granted') {
    throw new CalendarPermissionDeniedError(canAskAgain);
  }
}

// Every calendar the device will actually let us write an event into — the
// list a client picks from before exporting (see PlannerScreen's/
// InspirationDetailScreen's own useCalendarPicker). Replaces the old
// "silently guess the primary/default one" behavior: a device with several
// synced accounts (personal iCloud, a work Google Calendar, ...) can have
// more than one writable calendar, and picking one on the client's behalf
// with no say in it was the actual complaint this fixes. `getCalendarsAsync`
// itself is already cross-platform (unlike the iOS-only
// `getDefaultCalendarAsync` this used to lean on), so no OS branching is
// needed here.
export async function getAvailableCalendars() {
  await ensureCalendarPermission();
  const calendars = await Calendar.getCalendarsAsync(Calendar.EntityTypes.EVENT);
  return calendars
    .filter((cal) => cal.allowsModifications)
    .map((cal) => ({ id: cal.id, title: cal.title }));
}

// `date`: a plain Date for the calendar day the client picked (time-of-day
// on it is ignored — see EVENT_HOUR above). `itemNames`: the wardrobe/
// suggested item names for this look, joined into the event's `notes` —
// the whole point of exporting is to see "what to wear" right inside the
// OS calendar app without reopening Shoom. `calendarId`: which of
// `getAvailableCalendars()`'s own results the client picked — this no
// longer guesses one on its own. Returns the created event's id so the
// caller can hold onto it (see usePlannerStore's `setOutfitEventId`) for
// Smart Delete to find the same event again later.
export async function exportOutfitToCalendar({ itemNames = [], date, calendarId }) {
  await ensureCalendarPermission();

  const startDate = new Date(date);
  startDate.setHours(EVENT_HOUR, 0, 0, 0);
  const endDate = new Date(startDate.getTime() + EVENT_DURATION_MS);

  const eventId = await Calendar.createEventAsync(calendarId, {
    title: EVENT_TITLE,
    notes: itemNames.join('\n'),
    startDate,
    endDate,
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  });

  return eventId;
}

// Smart Delete's other half (see PlannerScreen's handleRemove) — removes
// the actual device-calendar event when a client clears a planned day that
// was previously exported. Deliberately doesn't swallow "the event's
// already gone" itself (unlike exportOutfitToCalendar, this has no
// reasonable fallback if the id doesn't resolve) — the caller wraps this in
// its own try/catch, since a client having already deleted the same event
// by hand in their own calendar app is a completely normal thing to have
// happened by the time they clear it here too, not a real error.
export async function deleteCalendarEvent(eventId) {
  await ensureCalendarPermission();
  await Calendar.deleteEventAsync(eventId);
}
