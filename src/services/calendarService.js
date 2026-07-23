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

// `Calendar.getDefaultCalendarAsync()` is iOS-only — calling it on Android
// throws (no such concept exists there; a device can have several
// equally-valid event calendars from different synced accounts). This is
// exactly the kind of cross-platform gap AGENTS.md's "Expo has changed,
// check the docs before writing code" warning exists for — the naive
// single call would work in the iOS simulator and crash the very first
// time a real Android device exercises this. Android instead asks for
// every calendar that supports EVENT entities and picks the device's own
// primary one (falling back to the first still-writable calendar if
// nothing is flagged primary — e.g. a device with only a secondary Google
// account's calendar synced).
async function getWritableCalendarId() {
  if (Platform.OS === 'ios') {
    const defaultCalendar = await Calendar.getDefaultCalendarAsync();
    return defaultCalendar.id;
  }

  const calendars = await Calendar.getCalendarsAsync(Calendar.EntityTypes.EVENT);
  const writable = calendars.filter((cal) => cal.allowsModifications);
  const target = writable.find((cal) => cal.isPrimary) || writable[0];
  if (!target) {
    throw new Error('No writable calendar found on this device.');
  }
  return target.id;
}

// `date`: a plain Date for the calendar day the client picked (time-of-day
// on it is ignored — see EVENT_HOUR above). `itemNames`: the wardrobe/
// suggested item names for this look, joined into the event's `notes` —
// the whole point of exporting is to see "what to wear" right inside the
// OS calendar app without reopening Shoom.
export async function exportOutfitToCalendar({ itemNames = [], date }) {
  if (Platform.OS === 'web') {
    throw new CalendarWebUnavailableError();
  }

  const { status, canAskAgain } = await Calendar.requestCalendarPermissionsAsync();
  if (status !== 'granted') {
    throw new CalendarPermissionDeniedError(canAskAgain);
  }

  const calendarId = await getWritableCalendarId();

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
