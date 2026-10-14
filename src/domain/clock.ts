/**
 * The one place the app and the Worker read "now" from.
 *
 * Normally it is real time, read from `Date` (so Playwright's clock still
 * works). Mock mode can pin it to a scenario's date and time in
 * America/Toronto; from there it ticks forward at real speed, so Live session
 * and rest timers still run. The Coach never reads it: callers turn "now" into
 * a LocalDate once, with `localDateIn`.
 *
 * `src/app/clockSeam.test.ts` fails if `new Date()` or `Date.now()` appears anywhere
 * else in src/app or src/worker.
 */

import { localDate, TIME_ZONE, type LocalDate } from './calendar'

/** Where a pinned clock started: the instant it shows, and the real time it was pinned at. */
let pin: { at: number; since: number } | null = null

/** Milliseconds since the epoch, like `Date.now()`. */
export function nowMs(): number {
  const real = Date.now()
  return pin ? pin.at + (real - pin.since) : real
}

/** Now as a `Date`, like `new Date()`. */
export function nowDate(): Date {
  return new Date(nowMs())
}

/**
 * Pins the clock to `time` (`HH:MM`) on `date` in `timeZone`, ticking forward
 * from there. Mock mode only.
 */
export function pinClock(date: LocalDate, time: string = '00:00', timeZone: string = TIME_ZONE): void {
  pin = { at: instantAt(localDate(date), time, timeZone), since: Date.now() }
}

/** Back to real time. */
export function unpinClock(): void {
  pin = null
}

const TIME = /^(\d{2}):(\d{2})$/

/** The instant (ms since the epoch) it is `time` (`HH:MM`) on `date` in `timeZone`. */
export function instantAt(date: LocalDate, time: string, timeZone: string = TIME_ZONE): number {
  const match = TIME.exec(time)
  if (!match) throw new Error(`Not a time: ${time}`)
  const [y, m, d] = date.split('-').map(Number)
  const wall = Date.UTC(y, m - 1, d, Number(match[1]), Number(match[2]))
  // Guess the zone's offset at the wall time, then correct it once in case
  // the guess landed on the other side of a daylight-saving change.
  let instant = wall - offsetAt(wall, timeZone)
  instant = wall - offsetAt(instant, timeZone)
  return instant
}

/** How far `timeZone`'s wall clock is ahead of UTC at `instant`, in milliseconds. */
function offsetAt(instant: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(instant))
  const get = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((p) => p.type === type)?.value)
  const wall = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'))
  return wall - Math.floor(instant / 1000) * 1000
}
