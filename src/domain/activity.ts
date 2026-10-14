/**
 * Activities: workouts recorded by the watch, sent from Apple Health by the
 * Workout Shortcut (ADR-0004), and the Coach's rules for matching them to
 * Sessions. Pure: no I/O, no clock.
 */
import { addDays, daysBetween, localDateIn, type LocalDate } from './calendar'
import { findWeek, programStart } from './coach'
import { trained, type SessionLog } from './log'
import type { Environment } from './paces'
import type { Program, Session, SessionType } from './program/types'

/** What a workout can stand for, read from Health's workout type. */
export type ActivityKind = 'run' | 'lifting' | 'circuit' | 'other'

export interface Activity {
  /** The start, as a UTC instant to the second: a resend of the same workout replaces it. */
  id: string
  /** The day it started, in America/Toronto. */
  date: LocalDate
  startedAt: string
  /** As Apple Health names it: "Running", "Functional Strength Training". */
  workoutType: string
  kind: ActivityKind
  minutes: number
  /** Null when Health has none; never trusted on a treadmill. */
  distanceMeters: number | null
  averageHeartRate: number | null
  maxHeartRate: number | null
  /** Whether the watch called it indoor; null when the Shortcut couldn't tell. */
  indoor: boolean | null
  /** ISO instant the server took it. */
  receivedAt: string
}

/** The athlete's answer to "Which Session was this?". Both null: none of these. */
export interface ActivityAnswer {
  activityId: string
  week: number | null
  sessionId: string | null
  updatedAt: string
}

/** The Session types each kind of workout can be. */
const FITS: Record<ActivityKind, readonly SessionType[]> = {
  run: ['speed', 'threshold', 'easy', '5k-test'],
  lifting: ['strength'],
  circuit: ['strength', 'hyrox', 'race-simulation'],
  other: [],
}

export function activityKind(workoutType: string): ActivityKind {
  const type = workoutType.toLowerCase()
  if (/\brun/.test(type)) return 'run'
  if (type.includes('traditional strength')) return 'lifting'
  if (/functional strength|high intensity|cross training|mixed (metabolic )?cardio|hyrox|core training/.test(type)) return 'circuit'
  return 'other'
}

const MAX_HOURS = 10
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/
const EDITED = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/

/** Checks what the Shortcut sends (or a stored row) and returns a clean Activity. Throws on anything else. */
export function parseActivity(value: unknown, receivedAt: string): Activity {
  if (typeof value !== 'object' || value === null) throw new Error('An Activity must be an object')
  const v = value as Record<string, unknown>
  const workoutType = typeof v.type === 'string' ? v.type.trim() : (v.workoutType as string | undefined)?.trim()
  if (!workoutType || workoutType.length > 64) throw new Error('type must be the workout type, up to 64 characters')
  const start = instant(v.start ?? v.startedAt, 'start')
  const end = v.end === undefined && typeof v.minutes === 'number' ? start + v.minutes * 60_000 : instant(v.end, 'end')
  if (end <= start) throw new Error('end must be after start')
  if (end - start < 30_000) throw new Error('A workout lasts at least a minute')
  if (end - start > MAX_HOURS * 3_600_000) throw new Error(`A workout lasts at most ${MAX_HOURS} hours`)

  const km = number(v.distanceKm, 'distanceKm')
  const meters = number(v.distanceMeters, 'distanceMeters')
  const withUnit = distance(v.distance)
  const sampled = distanceSamples(v.distanceSamples, [start, end])
  const distanceMeters =
    sampled ?? withUnit ?? (km !== null ? Math.round(km * 1000) : meters !== null ? Math.round(meters) : null)
  if (distanceMeters !== null && (distanceMeters < 1 || distanceMeters > 100_000)) {
    throw new Error('distance must be at most 100 km')
  }
  const rates = heartRates(v.heartRates, [start, end])
  const average = rates.length > 0 ? rates.reduce((a, b) => a + b, 0) / rates.length : number(v.averageHeartRate, 'averageHeartRate')
  const max = rates.length > 0 ? Math.max(...rates) : number(v.maxHeartRate, 'maxHeartRate')
  const id = new Date(start).toISOString().slice(0, 19) + 'Z'
  return {
    id,
    date: localDateIn(new Date(start)),
    startedAt: id,
    workoutType,
    kind: activityKind(workoutType),
    minutes: Math.round((end - start) / 60_000),
    distanceMeters,
    averageHeartRate: average === null ? null : Math.round(average),
    maxHeartRate: max === null ? null : Math.round(max),
    indoor: indoor(v.indoor, workoutType),
    receivedAt,
  }
}

function instant(value: unknown, name: string): number {
  const time = typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value.trim()) ? Date.parse(value.trim()) : NaN
  if (Number.isNaN(time)) {
    const got = typeof value === 'string' ? `"${value.trim().slice(0, 40)}"` : value === undefined ? 'nothing' : typeof value
    throw new Error(`${name} must be an ISO 8601 date and time, like 2026-11-04T07:12:00-05:00 (got ${got})`)
  }
  return time
}

/** A number, or numeric text; missing, empty or 0 is none. */
function number(value: unknown, name: string): number | null {
  const n = typeof value === 'string' && value.trim() !== '' ? Number(value.trim().replace(',', '.')) : value
  if (n === undefined || n === null || n === '' || n === 0) return null
  if (typeof n !== 'number' || !Number.isFinite(n) || n < 0) throw new Error(`${name} must be a number`)
  return n
}

const METERS_PER: Record<string, number> = { km: 1000, m: 1, mi: 1609.344 }

/** Distance as Shortcuts writes it, with its unit: "8.12 km", "8120 m", "5.04 mi". A bare number is km. */
function distance(value: unknown): number | null {
  if (value === undefined || value === null || value === '' || value === 0) return null
  if (typeof value === 'number') return number(value, 'distance') === null ? null : Math.round(value * 1000)
  const match = typeof value === 'string' ? /^\s*([\d.,]+)\s*(km|m|mi)?\s*$/i.exec(value) : null
  const n = match ? Number(match[1].replace(',', '.')) : NaN
  if (!match || !Number.isFinite(n)) throw new Error('distance must be a number with km, m or mi')
  return n === 0 ? null : Math.round(n * METERS_PER[(match[2] ?? 'km').toLowerCase()])
}

/** A sample within this much of the workout still counts: the automations fire a few seconds off. */
const WINDOW_SLACK_MS = 60_000
/** A sample's own time on its line: `2026-11-04T07:20:00-05:00`. */
const SAMPLE_TIME = /(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)/

/**
 * Splits one sample per line into its value and the rest, keeping only the
 * samples whose own time (when the line has one) falls within the workout.
 * The Shortcut reads Health samples from a fixed window, not the workout's,
 * because Shortcuts can't filter on a date read back from text.
 */
function samplesIn(value: string, name: string, [start, end]: readonly [number, number]): string[] {
  const lines = value.split(/[\n\r]+/).map((l) => l.trim()).filter(Boolean)
  if (lines.length > 20_000) throw new Error(`${name} has too many samples`)
  return lines.flatMap((line) => {
    const time = SAMPLE_TIME.exec(line)
    if (!time) return [line]
    const at = Date.parse(time[1])
    if (Number.isNaN(at)) throw new Error(`${name}: "${time[1]}" isn't a date and time`)
    if (at < start - WINDOW_SLACK_MS || at > end + WINDOW_SLACK_MS) return []
    return [line.replace(time[1], ' ').replace(/\s+/g, ' ').trim()]
  })
}

/**
 * Health's Walking + Running Distance samples over the workout, one per line:
 * the value, its unit if any (km when none), the sample's time if any, then
 * the device that measured it. The iPhone and the watch both write distance
 * for the same stretch, so each device's samples are added up and the device
 * with the most counts: nothing is counted twice.
 */
function distanceSamples(value: unknown, window: readonly [number, number]): number | null {
  if (value === undefined || value === null || value === '') return null
  if (typeof value !== 'string') throw new Error('distanceSamples must be text, one sample per line')
  const bySource = new Map<string, number>()
  for (const line of samplesIn(value, 'distanceSamples', window)) {
    const match = /^([\d.,]+)\s*(km|mi|m)?\b\s*(.*)$/i.exec(line)
    const n = match ? Number(match[1].replace(',', '.')) : NaN
    if (!match || !Number.isFinite(n)) {
      throw new Error(`distanceSamples must be "value unit time source" per line (got "${line.slice(0, 40)}")`)
    }
    const source = match[3].trim() || 'unknown'
    bySource.set(source, (bySource.get(source) ?? 0) + n * METERS_PER[(match[2] ?? 'km').toLowerCase()])
  }
  const most = Math.round(Math.max(0, ...bySource.values()))
  return most > 0 ? most : null
}

/** Health's heart-rate samples over the workout: a list, or text with one per line, each with its time if any. */
function heartRates(value: unknown, window: readonly [number, number]): number[] {
  if (value === undefined || value === null || value === '' || value === 0) return []
  const items = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? samplesIn(value.replace(/[;,]+/g, '\n'), 'heartRates', window)
      : null
  if (!items || items.length > 20_000) throw new Error('heartRates must be a list of numbers')
  return items
    .map((item) => (typeof item === 'string' ? item.trim() : item))
    .filter((item) => item !== '')
    .map((item) => {
      const n = typeof item === 'string' ? Number(item.replace(/\s*(bpm|count\/min)$/i, '')) : item
      if (typeof n !== 'number' || !Number.isFinite(n) || n < 25 || n > 250) {
        throw new Error(`heartRates must be numbers from 25 to 250 (got "${String(item).slice(0, 20)}")`)
      }
      return n
    })
}

function indoor(value: unknown, workoutType: string): boolean | null {
  if (value === true || value === false) return value
  if (typeof value === 'string' && /^(yes|true|1)$/i.test(value.trim())) return true
  if (typeof value === 'string' && /^(no|false|0)$/i.test(value.trim())) return false
  return /indoor/i.test(workoutType) ? true : /outdoor/i.test(workoutType) ? false : null
}

/** A treadmill run: distance comes from the console, not the watch. */
export function isTreadmill(activity: Activity, environmentOn: (date: LocalDate) => Environment): boolean {
  if (activity.kind !== 'run') return false
  return activity.indoor ?? environmentOn(activity.date) === 'indoor'
}

export function parseActivityAnswer(value: unknown): ActivityAnswer {
  if (typeof value !== 'object' || value === null) throw new Error('An answer must be an object')
  const v = value as Record<string, unknown>
  if (typeof v.activityId !== 'string' || !INSTANT.test(v.activityId)) throw new Error('activityId must be an Activity’s id')
  const week = v.week ?? null
  const sessionId = v.sessionId ?? null
  if ((week === null) !== (sessionId === null)) throw new Error('week and sessionId go together, or are both null')
  if (week !== null && (!Number.isInteger(week) || (week as number) < 1)) throw new Error('week must be a positive whole number')
  if (sessionId !== null && (typeof sessionId !== 'string' || sessionId.length === 0 || sessionId.length > 64)) {
    throw new Error('sessionId must be a short string')
  }
  if (typeof v.updatedAt !== 'string' || !EDITED.test(v.updatedAt)) throw new Error('updatedAt must be an ISO instant in UTC')
  return { activityId: v.activityId, week: week as number | null, sessionId: sessionId as string | null, updatedAt: v.updatedAt }
}

export function mergeAnswers(ours: ActivityAnswer[], theirs: ActivityAnswer[]): ActivityAnswer[] {
  const byId = new Map(ours.map((a) => [a.activityId, a]))
  for (const a of theirs) {
    const mine = byId.get(a.activityId)
    if (!mine || a.updatedAt > mine.updatedAt) byId.set(a.activityId, a)
  }
  return [...byId.values()]
}

export const answerFor = (answers: ActivityAnswer[], activityId: string) =>
  answers.find((a) => a.activityId === activityId) ?? null

export interface Candidate {
  week: number
  session: Session
}

export type ActivityOutcome =
  | { activity: Activity; state: 'attached'; week: number; sessionId: string; by: 'coach' | 'athlete' }
  /** More than one Session fits: Today asks "Which Session was this?". */
  | { activity: Activity; state: 'ambiguous'; candidates: Candidate[] }
  /** No Session of its type is open in its Week. */
  | { activity: Activity; state: 'unmatched' }
  /** The athlete said it was none of them. */
  | { activity: Activity; state: 'dismissed' }

/**
 * Matches each Activity to a Session by date and Session type. The athlete's
 * answers come first. Then, in start order, an Activity attaches to the one
 * fitting Session logged as trained on its day, of any Week (done early or
 * late), or, with none logged that day, the one fitting Session of its own
 * Week still Planned. With more than one logged that day, the one whose Live
 * session overlaps the Activity in time wins; otherwise it asks. A Session
 * takes at most one Activity.
 */
export function matchActivities(
  program: Program,
  activities: Activity[],
  logs: SessionLog[],
  answers: ActivityAnswer[],
): ActivityOutcome[] {
  const claimed = new Set<string>()
  const outcomes = new Map<string, ActivityOutcome>()
  const ordered = [...activities].sort((a, b) => a.startedAt.localeCompare(b.startedAt))

  for (const activity of ordered) {
    const answer = answerFor(answers, activity.id)
    if (!answer) continue
    if (answer.sessionId === null || answer.week === null) {
      outcomes.set(activity.id, { activity, state: 'dismissed' })
    } else if (!claimed.has(`${answer.week}/${answer.sessionId}`)) {
      claimed.add(`${answer.week}/${answer.sessionId}`)
      outcomes.set(activity.id, { activity, state: 'attached', week: answer.week, sessionId: answer.sessionId, by: 'athlete' })
    }
  }

  for (const activity of ordered) {
    if (outcomes.has(activity.id)) continue
    const fits = (week: number, session: Session) =>
      FITS[activity.kind].includes(session.type) && !claimed.has(`${week}/${session.id}`)
    const doneThatDay = new Map<string, Candidate>()
    const overlapping = new Map<string, Candidate>()
    for (const l of logs) {
      const session = findWeek(program, l.week)?.sessions.find((s) => s.id === l.sessionId)
      if (session && l.date === activity.date && trained(l) && fits(l.week, session)) {
        doneThatDay.set(`${l.week}/${session.id}`, { week: l.week, session })
        if (overlaps(activity, l)) overlapping.set(`${l.week}/${session.id}`, { week: l.week, session })
      }
    }
    const week = weekOn(program, activity.date)
    const planned = (week?.sessions ?? [])
      .filter((s) => fits(week!.number, s) && !logs.some((l) => l.week === week!.number && l.sessionId === s.id))
      .map((session) => ({ week: week!.number, session }))
    const candidates =
      doneThatDay.size > 1 && overlapping.size === 1
        ? [...overlapping.values()]
        : doneThatDay.size > 0
          ? [...doneThatDay.values()]
          : planned
    if (candidates.length === 1) {
      const [{ week: number, session }] = candidates
      claimed.add(`${number}/${session.id}`)
      outcomes.set(activity.id, { activity, state: 'attached', week: number, sessionId: session.id, by: 'coach' })
    } else if (candidates.length > 1) {
      outcomes.set(activity.id, { activity, state: 'ambiguous', candidates })
    } else {
      outcomes.set(activity.id, { activity, state: 'unmatched' })
    }
  }
  return activities.map((a) => outcomes.get(a.id)!)
}

/**
 * Whether a Session log's time on the clock overlaps the Activity. A Live
 * session saves when it finishes, so its log ran for `minutes` up to `updatedAt`.
 */
function overlaps(activity: Activity, log: SessionLog): boolean {
  if (log.minutes === null) return false
  const end = Date.parse(log.updatedAt)
  const start = end - log.minutes * 60_000
  const from = Date.parse(activity.startedAt)
  const to = from + activity.minutes * 60_000
  return Number.isFinite(end) && Number.isFinite(from) && start < to && from < end
}

/** The Week holding `date`, if the Program has encoded it. */
function weekOn(program: Program, date: LocalDate) {
  const offset = daysBetween(programStart(program), date)
  if (offset < 0 || addDays(date, 0) > program.raceDay) return null
  return findWeek(program, Math.floor(offset / 7) + 1)
}
