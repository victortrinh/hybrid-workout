/**
 * Session logs: what actually happened in a Session.
 *
 * The same records live in D1 and on the device. Ids are generated on the
 * device, so a log can be written before the server has seen it; on sync the
 * later `updatedAt` wins, per log.
 */
import { addDays, daysBetween, localDate, type LocalDate } from './calendar'
import { ENVIRONMENTS, FIVE_K_SECONDS, type Environment } from './paces'
import type { Activity, ActivityAnswer } from './activity'
import type { PainReport } from './pain'
import type { RecoveryNight } from './recovery'
import type { StartingPoint } from './startingPoint'
import { LIFTS, type LiftId } from './program/types'
import { stations } from './program/program'
import type { StationId } from './program/types'
import type { SuggestionDecision } from './suggestion'

export const LOGGED_STATUSES = ['done', 'partial', 'skipped', 'swapped'] as const

/** A Session status once something is logged; Planned is the absence of a log. */
export type LoggedStatus = (typeof LOGGED_STATUSES)[number]

export interface SessionLog {
  id: string
  /** The Program Session it logs: its Week number and its id within that Week. */
  week: number
  sessionId: string
  /** The day it was done (or skipped), in America/Toronto. */
  date: LocalDate
  status: LoggedStatus
  minutes: number | null
  /** Overall RPE, 1–10. */
  rpe: number | null
  notes: string | null
  /** A 5K test's time in seconds; it sets the Training paces. Null for every other Session. */
  resultSeconds: number | null
  /** Where a run happened. Recorded with each 5K test result and each Live run session. */
  environment: Environment | null
  /** The treadmill console's distance in metres: the watch guesses wrong indoors. */
  distanceMeters: number | null
  /** One per interval rep of a Live session: held the target, or what was run instead. */
  intervals: IntervalLog[]
  /** One per set logged in a Live Strength session, in Exercise and set order. */
  sets: SetLog[]
  /** A HYROX session's rounds or a Race simulation's splits: times, and the loads and distances actually done. */
  stations: StationLog[]
  /** ISO instant of the last edit. */
  updatedAt: string
}

/**
 * One rep of a Live session. Paces are seconds per km whatever the units, so
 * a treadmill speed and an outdoor pace are stored the same way.
 */
export interface IntervalLog {
  /** The rep's Block in the Live session, from 0. */
  block: number
  /** 1 for the first rep. */
  rep: number
  /** The target it was run against; null while runs are RPE only. */
  targetPace: number | null
  held: boolean
  /** What was run instead, when not held. */
  actualPace: number | null
}

/**
 * One set of a Live Strength session. Loads are pounds, the smallest step
 * 5 lb. The Coach reads each lift's sets to find and progress its Working weight.
 */
export interface SetLog {
  /** The Exercise's place among the Session's lifts, from 0. */
  exercise: number
  /** 1 for the first set. */
  set: number
  /** Null for bodyweight work: pull-ups and push-ups. */
  lift: LiftId | null
  pounds: number | null
  /** Per leg, for a single-leg Exercise. */
  reps: number
  rpe: number
}

/** What a Station log is of: a Station, the run before it, or a whole HYROX round. */
export type StationPart = StationId | 'run' | 'round'

/**
 * One line of a HYROX session or a Race simulation. A HYROX round logs its
 * time on the `round` line, and its run and Stations as done; a Race
 * simulation logs a split on every run and every Station, in race order.
 */
export interface StationLog {
  /** The round, from 1. In a Race simulation, the place of the run and its Station in the Session. */
  round: number
  part: StationPart
  /** Per implement; on a sled, the plates alone. Null where the Station has no load. */
  pounds: number | null
  meters: number | null
  reps: number | null
  /** The time it took; null where only the round was timed. */
  seconds: number | null
}

/** Everything the device needs from the server. More records join as they arrive. */
export interface SyncState {
  sessionLogs: SessionLog[]
  suggestionDecisions: SuggestionDecision[]
  painReports: PainReport[]
  /** Sent by the morning Shortcut, never by a device; older servers and stand-ins may leave it out. */
  recoveryNights?: RecoveryNight[]
  /** Sent by the Workout Shortcut, never by a device; older servers and stand-ins may leave it out. */
  activities?: Activity[]
  /** The athlete's answers to "Which Session was this?". */
  activityAnswers?: ActivityAnswer[]
  /** Null until the athlete answers the Starting point; older servers and stand-ins may leave it out. */
  startingPoint?: StartingPoint | null
}

export const NOTES_MAX = 2000
/** A treadmill console reading from 100 m to 100 km is believable. */
export const DISTANCE_METERS = [100, 100_000] as const
/** A Station's load per implement: an empty sled to a heavy one. */
export const STATION_POUNDS = [0, 1000] as const
/** A Station's or a run's distance. */
export const STATION_METERS = [1, 5000] as const
export const STATION_REPS = [1, 500] as const
/** A pace from 2:00/km (30 km/h) to 20:00/km (a walk). */
export const PACE_SECONDS = [120, 1200] as const
const MAX_INTERVALS = 50
const MAX_SETS = 60
/** From an empty hand to a heavy squat: anything else is a typo. */
export const POUNDS = [0, 1000] as const
const MAX_STATION_LOGS = 60
const STATION_PARTS: readonly StationPart[] = [...(Object.keys(stations) as StationId[]), 'run', 'round']
const ID = /^[A-Za-z0-9_-]{8,64}$/
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/

/** Trained that day: counts toward the spacing rules. Skipped and Swapped don't. */
export const trained = (log: SessionLog) => log.status === 'done' || log.status === 'partial'

/** Checks an untrusted value (a request body, a stored row) and returns a clean log. Throws on anything else. */
export function parseSessionLog(value: unknown): SessionLog {
  if (typeof value !== 'object' || value === null) throw new Error('A Session log must be an object')
  const v = value as Record<string, unknown>

  const id = v.id
  if (typeof id !== 'string' || !ID.test(id)) throw new Error('id must be 8–64 letters, digits, - or _')
  const week = v.week
  if (!Number.isInteger(week) || (week as number) < 1) throw new Error('week must be a positive whole number')
  const sessionId = v.sessionId
  if (typeof sessionId !== 'string' || sessionId.length === 0 || sessionId.length > 64) {
    throw new Error('sessionId must be a short string')
  }
  if (typeof v.date !== 'string') throw new Error('date must be an ISO date')
  const date = localDate(v.date)
  const status = v.status
  if (!LOGGED_STATUSES.includes(status as LoggedStatus)) {
    throw new Error(`status must be one of ${LOGGED_STATUSES.join(', ')}`)
  }
  const minutes = optionalInteger(v.minutes, 'minutes', 1, 600)
  const rpe = optionalInteger(v.rpe, 'rpe', 1, 10)
  const notes = v.notes ?? null
  if (notes !== null && (typeof notes !== 'string' || notes.length > NOTES_MAX)) {
    throw new Error(`notes must be text of at most ${NOTES_MAX} characters`)
  }
  const resultSeconds = optionalInteger(v.resultSeconds, 'resultSeconds', ...FIVE_K_SECONDS)
  const environment = v.environment ?? null
  if (environment !== null && !ENVIRONMENTS.includes(environment as Environment)) {
    throw new Error(`environment must be one of ${ENVIRONMENTS.join(', ')}`)
  }
  const distanceMeters = optionalInteger(v.distanceMeters, 'distanceMeters', ...DISTANCE_METERS)
  const intervals = parseIntervals(v.intervals ?? [])
  const sets = parseSets(v.sets ?? [])
  const stationLogs = parseStationLogs(v.stations ?? [])
  const updatedAt = v.updatedAt
  if (typeof updatedAt !== 'string' || !INSTANT.test(updatedAt) || Number.isNaN(Date.parse(updatedAt))) {
    throw new Error('updatedAt must be an ISO instant in UTC')
  }

  return {
    id,
    week: week as number,
    sessionId,
    date,
    status: status as LoggedStatus,
    minutes,
    rpe,
    notes: notes === null || notes.trim() === '' ? null : notes,
    resultSeconds,
    environment: environment as Environment | null,
    distanceMeters,
    intervals,
    sets,
    stations: stationLogs,
    updatedAt,
  }
}

function parseSets(value: unknown): SetLog[] {
  if (!Array.isArray(value) || value.length > MAX_SETS) throw new Error(`sets must be a list of at most ${MAX_SETS}`)
  const seen = new Set<string>()
  return value.map((item, i) => {
    if (typeof item !== 'object' || item === null) throw new Error(`sets[${i}] must be an object`)
    const v = item as Record<string, unknown>
    const exercise = optionalInteger(v.exercise, `sets[${i}].exercise`, 0, 19)
    const set = optionalInteger(v.set, `sets[${i}].set`, 1, 20)
    const reps = optionalInteger(v.reps, `sets[${i}].reps`, 0, 100)
    const rpe = optionalInteger(v.rpe, `sets[${i}].rpe`, 1, 10)
    if (exercise === null || set === null || reps === null || rpe === null) {
      throw new Error(`sets[${i}] needs an exercise, a set, reps and an RPE`)
    }
    const key = `${exercise}/${set}`
    if (seen.has(key)) throw new Error(`sets[${i}]: set ${set} of exercise ${exercise} is logged twice`)
    seen.add(key)
    const lift = v.lift ?? null
    if (lift !== null && !LIFTS.includes(lift as LiftId)) throw new Error(`sets[${i}].lift must be one of ${LIFTS.join(', ')}`)
    const pounds = optionalInteger(v.pounds, `sets[${i}].pounds`, ...POUNDS)
    if (pounds !== null && pounds % 5 !== 0) throw new Error(`sets[${i}].pounds must be a multiple of 5`)
    if (lift !== null && pounds === null) throw new Error(`sets[${i}]: a lift needs its load`)
    return { exercise, set, lift: lift as LiftId | null, pounds, reps, rpe }
  })
}

function parseIntervals(value: unknown): IntervalLog[] {
  if (!Array.isArray(value) || value.length > MAX_INTERVALS) {
    throw new Error(`intervals must be a list of at most ${MAX_INTERVALS}`)
  }
  const seen = new Set<number>()
  return value.map((item, i) => {
    if (typeof item !== 'object' || item === null) throw new Error(`intervals[${i}] must be an object`)
    const v = item as Record<string, unknown>
    const block = optionalInteger(v.block, `intervals[${i}].block`, 0, 99)
    const rep = optionalInteger(v.rep, `intervals[${i}].rep`, 1, 99)
    if (block === null || rep === null) throw new Error(`intervals[${i}] needs a block and a rep`)
    if (seen.has(block)) throw new Error(`intervals[${i}]: block ${block} is logged twice`)
    seen.add(block)
    if (typeof v.held !== 'boolean') throw new Error(`intervals[${i}].held must be true or false`)
    const targetPace = optionalInteger(v.targetPace, `intervals[${i}].targetPace`, ...PACE_SECONDS)
    const actualPace = optionalInteger(v.actualPace, `intervals[${i}].actualPace`, ...PACE_SECONDS)
    if (v.held && actualPace !== null) throw new Error(`intervals[${i}]: a held rep has no actual pace`)
    if (!v.held && actualPace === null) throw new Error(`intervals[${i}]: a changed rep needs its actual pace`)
    return { block, rep, targetPace, held: v.held, actualPace }
  })
}

function parseStationLogs(value: unknown): StationLog[] {
  if (!Array.isArray(value) || value.length > MAX_STATION_LOGS) {
    throw new Error(`stations must be a list of at most ${MAX_STATION_LOGS}`)
  }
  const seen = new Set<string>()
  return value.map((item, i) => {
    if (typeof item !== 'object' || item === null) throw new Error(`stations[${i}] must be an object`)
    const v = item as Record<string, unknown>
    const round = optionalInteger(v.round, `stations[${i}].round`, 1, 20)
    if (round === null) throw new Error(`stations[${i}] needs a round`)
    if (!STATION_PARTS.includes(v.part as StationPart)) {
      throw new Error(`stations[${i}].part must be a Station, run or round`)
    }
    const part = v.part as StationPart
    if (seen.has(`${round}/${part}`)) throw new Error(`stations[${i}]: ${part} in round ${round} is logged twice`)
    seen.add(`${round}/${part}`)
    return {
      round,
      part,
      pounds: optionalInteger(v.pounds, `stations[${i}].pounds`, ...STATION_POUNDS),
      meters: optionalInteger(v.meters, `stations[${i}].meters`, ...STATION_METERS),
      reps: optionalInteger(v.reps, `stations[${i}].reps`, ...STATION_REPS),
      seconds: optionalInteger(v.seconds, `stations[${i}].seconds`, 0, 3 * 3600),
    }
  })
}

function optionalInteger(value: unknown, name: string, min: number, max: number): number | null {
  if (value === undefined || value === null) return null
  if (!Number.isInteger(value) || (value as number) < min || (value as number) > max) {
    throw new Error(`${name} must be a whole number from ${min} to ${max}`)
  }
  return value as number
}

/** Both sets of logs, keeping the later edit of any log present in both. */
export function mergeLogs(ours: SessionLog[], theirs: SessionLog[]): SessionLog[] {
  const byId = new Map(ours.map((log) => [log.id, log]))
  for (const log of theirs) {
    const mine = byId.get(log.id)
    if (!mine || log.updatedAt > mine.updatedAt) byId.set(log.id, log)
  }
  return [...byId.values()]
}

/** The log that stands for a Session: the latest edit among its logs, or null while it's Planned. */
export function logFor(logs: SessionLog[], week: number, sessionId: string): SessionLog | null {
  let latest: SessionLog | null = null
  for (const log of logs) {
    if (log.week !== week || log.sessionId !== sessionId) continue
    if (!latest || log.updatedAt > latest.updatedAt) latest = log
  }
  return latest
}

/** Whether a required (non-optional) Session of the Week is still Planned: nothing logged for it yet. */
export function missingRequired(
  week: { number: number; sessions: { id: string; optional: boolean }[] },
  logs: SessionLog[],
): boolean {
  return week.sessions.some((s) => !s.optional && logFor(logs, week.number, s.id) === null)
}

export interface LogDays {
  /** The Session's own days, Monday to its last day: those after today can't be picked. */
  days: LocalDate[]
  /** Today, when it falls outside those days: the Session done early or late. */
  outside: LocalDate | null
  /** Before the Session's Week starts, or after its last day has passed. */
  when: 'early' | 'late' | null
}

/**
 * The days a Session can be logged on: any day of its Week up to today, or,
 * done early or late, today itself. It still counts for its own Week.
 */
export function logDays(startDate: LocalDate, lastDay: LocalDate, today: LocalDate): LogDays {
  const days = Array.from({ length: daysBetween(startDate, lastDay) + 1 }, (_, i) => addDays(startDate, i))
  const when = daysBetween(startDate, today) < 0 ? 'early' : daysBetween(lastDay, today) > 0 ? 'late' : null
  return { days, outside: when ? today : null, when }
}
