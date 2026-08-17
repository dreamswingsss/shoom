import { format } from 'date-fns';
import { ru } from 'date-fns/locale/ru';

// "Пт" / "Пятница, 10 июл" — every date shown anywhere in the app (Planner
// day cards, the "ask stylist for [date]" prompt, the save-to-planner sheet)
// goes through these, always in Russian (the app's only supported language).

// "Пт" — day cards (WeeklyPlanner, PlannerSetupView).
export function formatWeekdayShort(date) {
  return format(date, 'EEE', { locale: ru });
}

// "пятница, 10 июля" — the "ask stylist about [date]" prompt label and the
// save-to-planner sheet's day rows.
export function formatWeekdayLong(date) {
  return format(date, 'EEEE, d MMMM', { locale: ru });
}

// "Пт, 10 июл" — the save-to-planner "Saved for ..." confirmation.
export function formatWeekdayShortWithDate(date) {
  return format(date, 'EEE, d MMM', { locale: ru });
}

// "август 2026" — ProfileScreen's "@username · с нами с ..." line.
// `LLLL` (standalone month form) rather than `MMMM` (inflected) — the
// standalone form is what reads correctly with no day-of-month around it
// to grammatically agree with.
export function formatMemberSince(dateString) {
  if (!dateString) return null;
  return format(new Date(dateString), 'LLLL yyyy', { locale: ru });
}
