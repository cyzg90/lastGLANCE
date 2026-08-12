import dayjs from 'dayjs'
import localeData from 'dayjs/plugin/localeData'

// Locales are imported statically rather than on demand. They are ~1KB each,
// and a dynamic import would land after i18next has already told React to
// re-render for the new language — the app would paint one frame of dates in
// the old locale every time it changed. Synchronous switching removes the race.
import 'dayjs/locale/de'
import 'dayjs/locale/es'
import 'dayjs/locale/fr'
import 'dayjs/locale/it'
import 'dayjs/locale/pt'

dayjs.extend(localeData)

/**
 * Locale-aware date handling, split by responsibility:
 *
 *   • dayjs owns date *arithmetic*. Its locale decides where a week starts,
 *     which every calendar grid and heatmap column depends on — Sunday in
 *     en, Monday in the five others.
 *   • Intl.DateTimeFormat owns date *display*. It is CLDR-correct in every
 *     locale for free, including things a hand-written dayjs token cannot get
 *     right: field order ("Aug 12" vs "12 août"), whether a comma belongs
 *     between weekday and date, and 12- versus 24-hour time.
 *
 * Formatting a date anywhere in the app goes through this module, so no
 * component has to know which locale is active.
 */

const SUPPORTED = ['de', 'es', 'fr', 'it', 'pt'] as const

let activeLocale = 'en'

export function getActiveLocale(): string {
  return activeLocale
}

/**
 * Point date handling at a language. Safe to call with anything i18next
 * reports — a regional tag ("pt-BR"), an unsupported language, or undefined —
 * and falls back to English rather than throwing.
 *
 * Synchronous by design: it must complete before React re-renders for the new
 * language, or the first frame shows stale formatting.
 */
export function applyDateLocale(lng: string | undefined): void {
  const base = (lng ?? 'en').split('-')[0].toLowerCase()
  const supported = (SUPPORTED as readonly string[]).includes(base)
  activeLocale = supported ? base : 'en'
  dayjs.locale(activeLocale)
  formatterCache.clear()
}

// Intl.DateTimeFormat construction is comparatively expensive and these run per
// row, so formatters are memoised. Cleared whenever the locale changes.
const formatterCache = new Map<string, Intl.DateTimeFormat>()

function formatter(opts: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = JSON.stringify(opts)
  let f = formatterCache.get(key)
  if (!f) {
    f = new Intl.DateTimeFormat(activeLocale, opts)
    formatterCache.set(key, f)
  }
  return f
}

export type DateInput = string | number | Date | dayjs.Dayjs

function toDate(value: DateInput): Date {
  return dayjs(value).toDate()
}

/** "Aug 12, 2026" · "12 août 2026" */
export function formatDate(value: DateInput): string {
  return formatter({ year: 'numeric', month: 'short', day: 'numeric' }).format(toDate(value))
}

/** "2:05 PM" in en, "14:05" everywhere else — Intl picks the clock per locale. */
export function formatTime(value: DateInput): string {
  return formatter({ hour: 'numeric', minute: '2-digit' }).format(toDate(value))
}

/** "Aug 12, 2026, 2:05 PM" · "12 août 2026, 14:05" */
export function formatDateTime(value: DateInput): string {
  return formatter({
    year: 'numeric', month: 'short', day: 'numeric',
    hour: 'numeric', minute: '2-digit',
  }).format(toDate(value))
}

/** "Wednesday, August 12, 2026" · "mercredi 12 août 2026" (no comma in fr). */
export function formatDayHeading(value: DateInput): string {
  return formatter({
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  }).format(toDate(value))
}

/** "Aug 12" · "12 août" — field order follows the locale. */
export function formatMonthDay(value: DateInput): string {
  return formatter({ month: 'short', day: 'numeric' }).format(toDate(value))
}

/** "August 2026" · "août 2026" */
export function formatMonthYear(value: DateInput): string {
  return formatter({ month: 'long', year: 'numeric' }).format(toDate(value))
}

/** "Aug" · "août" */
export function formatMonthShort(value: DateInput): string {
  return formatter({ month: 'short' }).format(toDate(value))
}

/** 0 for Sunday-start locales (en), 1 for Monday-start (the other five). */
export function firstDayOfWeek(): number {
  return dayjs.localeData().firstDayOfWeek()
}

/**
 * Two-letter weekday initials in the active locale's week order, so a calendar
 * header lines up with the columns dayjs's startOf('week') actually produces.
 */
export function weekdayMinLabels(): string[] {
  const sundayFirst = dayjs.weekdaysMin()
  const start = firstDayOfWeek()
  return Array.from({ length: 7 }, (_, i) => sundayFirst[(start + i) % 7])
}

/**
 * Single-letter initial for the weekday `offset` rows into the week, for the
 * heatmaps' sparse row labels. `weekday` is the real day number (0 = Sunday),
 * so a caller can ask "is this row Monday?" without assuming where the week
 * starts.
 */
export function weekdayAtOffset(offset: number): { weekday: number; narrow: string } {
  const weekday = (firstDayOfWeek() + offset) % 7
  // A known Sunday, advanced to the weekday we want — independent of today.
  const sunday = dayjs('2024-01-07')
  return {
    weekday,
    narrow: formatter({ weekday: 'narrow' }).format(sunday.add(weekday, 'day').toDate()),
  }
}
