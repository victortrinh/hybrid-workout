/**
 * Recovery data and the rules that read it (docs/training-plan.md, Rules, 3).
 *
 * One night per morning, sent by the iOS Shortcut from Apple Health,
 * filtered to the ring (ADR-0003). Sleep under 6 hours takes one rep off and
 * caps RPE for that day's Hard session; HRV at least 15% under its 7-day mean
 * on top of that is a Suggestion to make the day easy. No night, no change:
 * the athlete is never asked to type it in.
 */
import { addDays, localDate, localDateIn, type LocalDate } from './calendar'
import type { Block, Exercise, Prescription, Range, RunEffort, Session } from './program/types'

export interface RecoveryNight {
  /** The morning the night ends on, in America/Toronto: the day it changes. */
  date: LocalDate
  /** Time asleep. */
  sleepMinutes: number
  /** Overnight heart-rate variability; null when the ring has none for the night. */
  hrvMs: number | null
  restingHeartRate: number | null
  /** The device that measured it, as Apple Health names it. */
  source: string
  /** ISO instant the server took it: a resend of the same morning replaces it. */
  receivedAt: string
}

/** Sleep under this is short: one rep fewer and an RPE cap. */
export const SHORT_SLEEP_MINUTES = 6 * 60
/** The ceiling on a short-sleep day's Hard session. */
export const SLEEP_RPE_CAP = 7
/** Nights before the morning that HRV is compared with. */
export const HRV_BASELINE_NIGHTS = 7
/** Fewer nights than this with HRV, and there is no mean to compare with. */
export const HRV_BASELINE_MIN = 3
/** HRV this far under its mean, in percent, is low. */
export const LOW_HRV_PERCENT = 15
/** The easy day a low-HRV short night calls for: no longer than this. */
export const EASY_DAY_MINUTES = 30

export const isShortSleep = (night: RecoveryNight) => night.sleepMinutes < SHORT_SLEEP_MINUTES

/** The night ending on `date`, if the Shortcut sent one. */
export function nightOf(nights: RecoveryNight[], date: LocalDate): RecoveryNight | null {
  return nights.find((n) => n.date === date) ?? null
}

/** The mean HRV of the 7 nights before `date`, rounded to the ms; null with fewer than 3 of them. */
export function hrvMean(nights: RecoveryNight[], date: LocalDate): number | null {
  const from = addDays(date, -HRV_BASELINE_NIGHTS)
  const values = nights
    .filter((n) => n.date >= from && n.date < date && n.hrvMs !== null)
    .map((n) => n.hrvMs as number)
  if (values.length < HRV_BASELINE_MIN) return null
  return Math.round(values.reduce((sum, v) => sum + v, 0) / values.length)
}

export const isLowHrv = (hrvMs: number | null, mean: number | null) =>
  hrvMs !== null && mean !== null && hrvMs <= (mean * (100 - LOW_HRV_PERCENT)) / 100

/** What a morning's numbers say, for the day they end on. */
export interface Readout {
  night: RecoveryNight
  /** The 7-night HRV mean it is compared with; null without enough nights. */
  hrvMean: number | null
  shortSleep: boolean
  /** Short sleep and HRV at least 15% under its mean: the Suggestion. */
  easyDay: boolean
}

export function readout(nights: RecoveryNight[], date: LocalDate): Readout | null {
  const night = nightOf(nights, date)
  if (!night) return null
  const mean = hrvMean(nights, date)
  const shortSleep = isShortSleep(night)
  return { night, hrvMean: mean, shortSleep, easyDay: shortSleep && isLowHrv(night.hrvMs, mean) }
}

// ---------------------------------------------------------------------------
// What the rules do to a Session.

/**
 * The short-sleep rule: one rep fewer in the main Block and nothing past
 * RPE 7. A 5K test and anything pinned to a day (the race) stay as they
 * are: a capped test isn't a test.
 */
export function shortSleepAdapted(session: Session, night: RecoveryNight): Session {
  if (session.type === '5k-test' || session.date) return session
  let saved = 0
  const blocks = session.blocks.map((block): Block => {
    if (!block.main) return block
    const intervals = block.exercises.find((e) => e.prescription.kind === 'intervals')?.prescription
    let minutes = block.minutes
    if (intervals?.kind === 'intervals' && minutes !== undefined && intervals.reps > 1) {
      minutes = Math.round((minutes * (intervals.reps - 1)) / intervals.reps)
      saved += block.minutes! - minutes
    }
    return { ...block, minutes, exercises: block.exercises.map(oneRepFewer) }
  })
  const mainReps = session.blocks
    .filter((b) => b.main)
    .flatMap((b) => b.exercises)
    .map((e) => e.prescription)
    .find((rx) => rx.kind === 'intervals')?.reps
  const why = `Short sleep (${sleepText(night.sleepMinutes)}): one rep fewer, nothing past RPE ${SLEEP_RPE_CAP}.`
  return {
    ...session,
    headline:
      mainReps === undefined ? session.headline : session.headline.replace(/^\d+(?= × )/, String(Math.max(1, mainReps - 1))),
    minutes: session.minutes - saved,
    note: session.note ? `${why} ${session.note}` : why,
    blocks,
  }
}

function oneRepFewer(exercise: Exercise): Exercise {
  return { ...exercise, prescription: capped(exercise.prescription) }
}

function capped(rx: Prescription): Prescription {
  switch (rx.kind) {
    case 'intervals':
      return { ...rx, reps: Math.max(1, rx.reps - 1), effort: cappedEffort(rx.effort) }
    case 'sets':
      return {
        ...rx,
        reps: typeof rx.reps === 'number' ? Math.max(1, rx.reps - 1) : fewer(rx.reps),
        rpe: rx.rpe && cappedRange(rx.rpe),
        rpeCap: Math.min(rx.rpeCap ?? SLEEP_RPE_CAP, SLEEP_RPE_CAP),
      }
    case 'run':
      return rx.effort ? { ...rx, effort: cappedEffort(rx.effort) } : rx
    default:
      return rx
  }
}

const fewer = ([low, high]: Range): Range => [Math.max(1, low - 1), Math.max(1, high - 1)]

const cappedRange = ([low, high]: Range): Range => [Math.min(low, SLEEP_RPE_CAP), Math.min(high, SLEEP_RPE_CAP)]

const cappedEffort = (effort: RunEffort): RunEffort => (effort.rpe ? { ...effort, rpe: cappedRange(effort.rpe) } : effort)

/**
 * An accepted low-HRV Suggestion: the Hard session becomes an easy 30′, run
 * or bike, or rest. The race stays the race.
 */
export function easyDayAdapted(session: Session): Session {
  if (session.date) return session
  const minutes = Math.min(session.minutes, EASY_DAY_MINUTES)
  return {
    ...session,
    headline: `easy ${minutes}′ or rest`,
    minutes,
    note: 'Short night, low HRV. Easy or nothing.',
    blocks: [
      {
        name: 'Easy',
        minutes,
        main: true,
        exercises: [
          {
            name: 'Easy run or bike',
            prescription: { kind: 'note', minutes },
            note: 'Conversational, or rest. Nothing hard today.',
          },
        ],
      },
    ],
  }
}

/** "5 h 41", "7 h 05" */
export function sleepText(minutes: number): string {
  return `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, '0')}`
}

// ---------------------------------------------------------------------------
// The Shortcut's request.

const SOURCE = /^[\p{L}\p{N} ._'’()-]{1,64}$/u

/**
 * Checks what the Shortcut sent and returns a clean night, stamped with the
 * instant it arrived. Numbers may come with decimals (Shortcuts sums
 * durations as decimals) or as text, and are rounded. A Health query that
 * found nothing comes through empty or as 0: for HRV and resting heart rate
 * that is no reading, but no sleep at all means the ring hasn't synced yet,
 * and the night is refused rather than read as 0 hours. Throws on anything else.
 */
export function parseRecoveryNight(value: unknown, receivedAt: string): RecoveryNight {
  if (typeof value !== 'object' || value === null) throw new Error('The body must be an object')
  const v = value as Record<string, unknown>
  const date = morning(v.date, receivedAt)
  const sleepMinutes =
    typeof v.sleep === 'string' && v.sleep.trim() !== ''
      ? lastNight(v.sleep, receivedAt)
      : reading(v.sleepMinutes, 'sleepMinutes', [1, 24 * 60])
  if (sleepMinutes === null) {
    throw new Error('No sleep in Apple Health from the ring yet: open the Ultrahuman app, then run the Shortcut again')
  }
  const hrvMs = reading(v.hrvMs, 'hrvMs', [1, 300])
  const restingHeartRate = reading(v.restingHeartRate, 'restingHeartRate', [20, 150])
  if (typeof v.source !== 'string' || !SOURCE.test(v.source.trim())) {
    throw new Error('source must be the device name, up to 64 characters')
  }
  return { date, sleepMinutes, hrvMs, restingHeartRate, source: v.source.trim(), receivedAt }
}

/**
 * The morning a night is for: `yyyy-MM-dd` as sent, the day in Toronto of a
 * full timestamp, or, with no date at all, the day it arrived in Toronto. The
 * Shortcut runs in the morning, so it can leave the date out.
 */
function morning(value: unknown, receivedAt: string): LocalDate {
  if (value === undefined || value === null || (typeof value === 'string' && value.trim() === '')) {
    return localDateIn(new Date(receivedAt))
  }
  if (typeof value !== 'string') throw new Error('date must be yyyy-MM-dd, or left out for today')
  const text = value.trim()
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return localDate(text)
  const instant = new Date(text)
  if (/^\d{4}-\d{2}-\d{2}T/.test(text) && !Number.isNaN(instant.getTime())) return localDateIn(instant)
  throw new Error(`date must be yyyy-MM-dd, or left out for today (got "${text.slice(0, 40)}")`)
}

/** Entries this far apart belong to different nights. */
export const NIGHT_GAP_MINUTES = 3 * 60
/** Entries are read back this far from arrival: a night and the day before it. */
const LOOKBACK_HOURS = 36

/**
 * Last night's sleep from Apple Health's raw entries, one `start end` pair
 * per line (ISO timestamps). Health holds an entry per stage from every
 * device that tracked the night, so overlapping entries are merged and each
 * minute counts once, as Health's own total does. Of what's left, only the
 * latest night counts: entries more than 3 hours before the next belong to
 * the night before. Null when there is no entry at all.
 */
export function lastNight(text: string, receivedAt: string): number | null {
  const now = Date.parse(receivedAt)
  const lines = text.split(/[\n\r;]+/).map((l) => l.trim()).filter(Boolean)
  if (lines.length > 2000) throw new Error('sleep has too many entries')
  const spans = lines.map((line) => {
    const [start, end] = line.split(/\s*[ ,|\t]\s*/).filter(Boolean)
    const from = Date.parse(start ?? '')
    const to = Date.parse(end ?? '')
    if (Number.isNaN(from) || Number.isNaN(to) || to < from) {
      throw new Error(`sleep must be one "start end" pair of ISO timestamps per line (got "${line.slice(0, 60)}")`)
    }
    return [from, to] as const
  })
  const recent = spans
    .filter(([, to]) => to > now - LOOKBACK_HOURS * 3_600_000 && to <= now + 600_000)
    .sort((a, b) => a[0] - b[0])
  // Union of the entries: overlapping ones merge into one block.
  const blocks: [number, number][] = []
  for (const [from, to] of recent) {
    const last = blocks.at(-1)
    if (last && from <= last[1]) last[1] = Math.max(last[1], to)
    else blocks.push([from, to])
  }
  if (blocks.length === 0) return null
  // The latest night: walk back from the last block while the gaps stay short.
  let total = 0
  for (let i = blocks.length - 1; i >= 0; i--) {
    total += blocks[i][1] - blocks[i][0]
    if (i > 0 && blocks[i][0] - blocks[i - 1][1] > NIGHT_GAP_MINUTES * 60_000) break
  }
  const minutes = Math.round(total / 60_000)
  return minutes > 0 ? Math.min(minutes, 24 * 60) : null
}

/** A number, or numeric text; missing, empty or 0 is no reading. */
function reading(value: unknown, name: string, [min, max]: readonly [number, number]): number | null {
  const number = typeof value === 'string' && value.trim() !== '' ? Number(value.trim()) : value
  if (number === undefined || number === null || number === '' || number === 0) return null
  if (typeof number !== 'number' || !Number.isFinite(number)) throw new Error(`${name} must be a number`)
  const rounded = Math.round(number)
  if (rounded < min || rounded > max) throw new Error(`${name} must be from ${min} to ${max}`)
  return rounded
}

/** Both sets of nights, one per morning, keeping the later arrival. */
export function mergeNights(ours: RecoveryNight[], theirs: RecoveryNight[]): RecoveryNight[] {
  const byDate = new Map(ours.map((n) => [n.date, n]))
  for (const n of theirs) {
    const mine = byDate.get(n.date)
    if (!mine || n.receivedAt > mine.receivedAt) byDate.set(n.date, n)
  }
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date))
}
