import type { Activity } from '../domain/activity'
import { TIME_ZONE, toDisplayDate, type LocalDate } from '../domain/calendar'
import type { LoggedStatus } from '../domain/log'

const formatter = (options: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', ...options })

const dayMonthLong = formatter({ weekday: 'short', day: 'numeric', month: 'long' })
const dayMonthShort = formatter({ weekday: 'short', day: 'numeric', month: 'short' })
const weekdayLong = formatter({ weekday: 'long' })
const weekdayDay = formatter({ weekday: 'short', day: 'numeric' })

/** "Wed 21 April" */
export const longDay = (date: LocalDate) => dayMonthLong.format(toDisplayDate(date))

/** "Mon 19 Oct" */
export const shortDay = (date: LocalDate) => dayMonthShort.format(toDisplayDate(date))

/** "Monday" */
export const weekday = (date: LocalDate) => weekdayLong.format(toDisplayDate(date))

/** "Mon 19 – Sun 25 Oct", or "Mon 26 Oct – Sun 1 Nov" across a month. */
export function weekRange(start: LocalDate, end: LocalDate): string {
  const sameMonth = start.slice(0, 7) === end.slice(0, 7)
  const from = sameMonth ? weekdayDay.format(toDisplayDate(start)) : shortDay(start)
  return `${from} – ${shortDay(end)}`
}

/** Keeps "5 × 2′" and "4 accelerations" on one line, and never starts a line with a "·" separator. */
export const nb = (text: string) =>
  text
    .replaceAll(' × ', '\u00a0×\u00a0')
    .replaceAll(' · ', '\u00a0· ')
    .replace(/(\d) (?=\p{L})/gu, '$1\u00a0')

export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

const weekdayShort = formatter({ weekday: 'short' })

/** "Mon" */
export const shortWeekday = (date: LocalDate) => weekdayShort.format(toDisplayDate(date))

export const STATUS_LABEL: Record<LoggedStatus, string> = {
  done: 'Done',
  partial: 'Partial',
  skipped: 'Skipped',
  swapped: 'Swapped',
}

const clockTime = new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE, hour: 'numeric', minute: '2-digit', hour12: false })

/** "7:12", in Toronto. */
export const timeOfDay = (instant: string) => clockTime.format(new Date(instant)).replace(/^0(?=\d)/, '')

/** "8.12 km" */
export const km = (meters: number) => `${(meters / 1000).toFixed(2)} km`

/**
 * What the watch recorded: "45 min · 8.12 km · avg 152 bpm". No distance
 * from a treadmill: the watch guesses it indoors.
 */
export function activitySummary(activity: Activity, treadmill: boolean): string {
  return [
    `${activity.minutes} min`,
    activity.distanceMeters !== null && !treadmill ? km(activity.distanceMeters) : null,
    activity.averageHeartRate !== null ? `avg ${activity.averageHeartRate} bpm` : null,
  ]
    .filter(Boolean)
    .join(' · ')
}
