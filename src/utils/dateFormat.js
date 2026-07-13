import { format } from 'date-fns';
// Deliberately NOT `import { enUS, es, ... } from 'date-fns/locale'` — that
// barrel re-exports all ~100 date-fns locales via one `require()` per
// locale, and Metro (unlike webpack) bundles every one of those reachable
// requires regardless of which named exports actually get used. Importing
// each locale from its own subpath keeps only the 6 this app ships in the
// bundle.
import { enUS } from 'date-fns/locale/en-US';
import { es } from 'date-fns/locale/es';
import { it } from 'date-fns/locale/it';
import { pt } from 'date-fns/locale/pt';
import { fr } from 'date-fns/locale/fr';
import { de } from 'date-fns/locale/de';

// Maps i18next's language codes 1:1 to date-fns locale objects. Every
// date shown anywhere in the app (Planner day cards, the "ask stylist for
// [date]" prompt, the save-to-planner sheet) must go through these instead
// of `date.toLocaleDateString(undefined, ...)` — `undefined` there means
// "whatever locale the device/browser is set to", which is completely
// independent of the language the client picked in-app (that's exactly how
// you get Russian weekday names inside a Spanish-language UI).
const DATE_FNS_LOCALES = { en: enUS, es, it, pt, fr, de };

export function getDateFnsLocale(languageCode) {
  return DATE_FNS_LOCALES[languageCode] || enUS;
}

// "Fri" / "Vie" / "Ven" — day cards (WeeklyPlanner, PlannerSetupView).
export function formatWeekdayShort(date, languageCode) {
  return format(date, 'EEE', { locale: getDateFnsLocale(languageCode) });
}

// "Friday, Jul 10" — the "ask stylist about [date]" prompt label and the
// save-to-planner sheet's day rows.
export function formatWeekdayLong(date, languageCode) {
  return format(date, 'EEEE, MMM d', { locale: getDateFnsLocale(languageCode) });
}

// "Fri, Jul 10" — the save-to-planner "Saved for ..." confirmation.
export function formatWeekdayShortWithDate(date, languageCode) {
  return format(date, 'EEE, MMM d', { locale: getDateFnsLocale(languageCode) });
}
