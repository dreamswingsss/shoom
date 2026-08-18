// Universal calendar export — no account connection needed, works with
// Apple Calendar, Outlook, and Google Calendar alike (every calendar app
// understands a plain .ics file). The only real answer for "Apple Calendar"
// specifically: Apple has no public OAuth/REST API a third-party web app
// could use the way googleCalendarService.js uses Google's, so a downloadable
// file the client imports themselves is the actual state of the art here,
// not a gap in this implementation.
//
// Deliberately minimal RFC5545 — one VEVENT, the same fields
// calendarService.js's old exportOutfitToCalendar already wrote (title,
// start/end, notes), nothing this app doesn't already track.
const EVENT_HOUR = 9;
const EVENT_DURATION_MS = 60 * 60 * 1000;

function toIcsDate(date) {
  // 20260818T090000Z — floating local time isn't reliable across every
  // calendar client, so this expresses the event in UTC (toISOString
  // already is UTC) and strips the ICS-illegal punctuation.
  return date.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
}

// Folds long lines and escapes commas/semicolons/newlines per RFC5545 —
// without this, a long item list in DESCRIPTION can corrupt the file for
// stricter parsers (Outlook in particular).
function escapeIcsText(text) {
  return String(text).replace(/[\\;,]/g, (match) => `\\${match}`).replace(/\n/g, '\\n');
}

export function buildOutfitIcs({ itemNames = [], date }) {
  const startDate = new Date(date);
  startDate.setHours(EVENT_HOUR, 0, 0, 0);
  const endDate = new Date(startDate.getTime() + EVENT_DURATION_MS);
  const uid = `shoom-outfit-${startDate.getTime()}@shoom-dusky.vercel.app`;

  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Shoom//Outfit Export//RU',
    'CALSCALE:GREGORIAN',
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${toIcsDate(new Date())}`,
    `DTSTART:${toIcsDate(startDate)}`,
    `DTEND:${toIcsDate(endDate)}`,
    'SUMMARY:Shoom Outfit',
    `DESCRIPTION:${escapeIcsText(itemNames.join('\n'))}`,
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n');
}

// Triggers a browser download — this app is web-only in practice (Telegram
// Mini App), so a Blob + anchor-click is the one path that matters; no
// expo-sharing/expo-file-system fallback since there's no real native build
// of this app running outside Telegram today.
export function downloadIcs(icsContent, filename = 'shoom-outfit.ics') {
  const blob = new Blob([icsContent], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
