/**
 * Calendar dates without a time of day, in the athlete's time zone.
 *
 * Every day boundary in the app is America/Toronto. The Coach never reads a
 * clock: callers turn "now" into a LocalDate once, with `localDateIn`, and
 * everything after that is plain day arithmetic that can't drift across a
 * daylight-saving change.
 */

export const TIME_ZONE = 'America/Toronto'

/** An ISO calendar date, `YYYY-MM-DD`. */
export type LocalDate = string & { readonly __brand: 'LocalDate' }

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/
const DAY_MS = 86_400_000

/** Checks and brands an ISO `YYYY-MM-DD` string. Throws on anything else. */
export function localDate(iso: string): LocalDate {
  const match = ISO_DATE.exec(iso)
  if (!match) throw new Error(`Not an ISO date: ${iso}`)
  const [, y, m, d] = match.map(Number)
  const utc = new Date(Date.UTC(y, m - 1, d))
  if (utc.getUTCFullYear() !== y || utc.getUTCMonth() !== m - 1 || utc.getUTCDate() !== d) {
    throw new Error(`Not a calendar date: ${iso}`)
  }
  return iso as LocalDate
}

/** The calendar date it is at `instant` in `timeZone`. */
export function localDateIn(instant: Date, timeZone: string = TIME_ZONE): LocalDate {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(instant)
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value
  return localDate(`${get('year')}-${get('month')}-${get('day')}`)
}

function toEpochDay(date: LocalDate): number {
  const [y, m, d] = date.split('-').map(Number)
  return Date.UTC(y, m - 1, d) / DAY_MS
}

function fromEpochDay(day: number): LocalDate {
  return new Date(day * DAY_MS).toISOString().slice(0, 10) as LocalDate
}

export function addDays(date: LocalDate, days: number): LocalDate {
  return fromEpochDay(toEpochDay(date) + days)
}

/** Whole days from `from` to `to`; negative when `to` is earlier. */
export function daysBetween(from: LocalDate, to: LocalDate): number {
  return toEpochDay(to) - toEpochDay(from)
}

/** ISO weekday: Monday is 1, Sunday is 7. */
export function isoWeekday(date: LocalDate): number {
  const day = new Date(toEpochDay(date) * DAY_MS).getUTCDay()
  return day === 0 ? 7 : day
}

/** The Monday on or before `date`. */
export function mondayOf(date: LocalDate): LocalDate {
  return addDays(date, 1 - isoWeekday(date))
}

/** For display: a Date at noon UTC on `date`, safe to format in any zone. */
export function toDisplayDate(date: LocalDate): Date {
  return new Date(toEpochDay(date) * DAY_MS + DAY_MS / 2)
}
