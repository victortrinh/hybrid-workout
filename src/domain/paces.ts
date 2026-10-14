/**
 * Training paces and run targets.
 *
 * The latest 5K test gives a VDOT (Daniels and Gilbert's oxygen-cost and
 * time-to-exhaustion equations, the ones behind Daniels' tables), and each
 * Training pace is the speed that costs a fixed share of it. Before the
 * baseline test there are no paces and run Prescriptions stay RPE only.
 *
 * Paces are seconds per km. Indoor runs read as treadmill speed and incline,
 * Outdoor runs as pace per km.
 */
import { daysBetween, type LocalDate } from './calendar'
import type { SessionLog } from './log'
import type { PaceRef, Range, RunEffort } from './program/types'

export const ENVIRONMENTS = ['indoor', 'outdoor'] as const
export type Environment = (typeof ENVIRONMENTS)[number]

export const SPEED_UNITS = ['kmh', 'mph'] as const
export type SpeedUnit = (typeof SPEED_UNITS)[number]

/** Treadmill incline when the Prescription doesn't say: 1% stands in for the air outdoors. */
export const DEFAULT_INCLINE = 1

/** Sub-20: 4:00 per km. */
export const GOAL_PACE = 240

export const KM_PER_MILE = 1.609344

export interface TrainingPaces {
  /** The 5K test time these paces come from, in seconds. */
  fromSeconds: number
  vdot: number
  /** Seconds per km. */
  fiveK: number
  threshold: number
  /** Easy is a range: the faster end first. */
  easy: Range
}

/** What a run Prescription is resolved against. */
export interface RunContext {
  /** Null until the baseline 5K test: then every run is RPE only. */
  paces: TrainingPaces | null
  environment: Environment
  unit: SpeedUnit
}

/**
 * Shares of VDOT each Training pace costs. Threshold is Daniels' 88%. Easy
 * is the middle of Daniels' 59–74% band, 62–70%, which is where the
 * Program's own example puts it (5:50–6:30/km from a 23:00 test).
 */
const THRESHOLD_SHARE = 0.88
const EASY_SHARES: Range = [0.7, 0.62]

/** Oxygen cost, ml/kg/min, of running at `v` metres per minute. */
const oxygenCost = (v: number) => -4.6 + 0.182258 * v + 0.000104 * v * v

/** The share of VO2max that can be held for `minutes`. */
const sustainableShare = (minutes: number) =>
  0.8 + 0.1894393 * Math.exp(-0.012778 * minutes) + 0.2989558 * Math.exp(-0.1932605 * minutes)

/** The speed, metres per minute, whose oxygen cost is `vo2`. */
function speedAtCost(vo2: number): number {
  const a = 0.000104
  const b = 0.182258
  const c = -4.6 - vo2
  return (-b + Math.sqrt(b * b - 4 * a * c)) / (2 * a)
}

/** VDOT from a 5K time in seconds. */
export function vdot(fiveKSeconds: number): number {
  const minutes = fiveKSeconds / 60
  return oxygenCost(5000 / minutes) / sustainableShare(minutes)
}

const secondsPerKm = (metresPerMinute: number) => Math.round(60_000 / metresPerMinute)

export function trainingPaces(fiveKSeconds: number): TrainingPaces {
  const v = vdot(fiveKSeconds)
  const at = (share: number) => secondsPerKm(speedAtCost(v * share))
  return {
    fromSeconds: fiveKSeconds,
    vdot: v,
    fiveK: Math.round(fiveKSeconds / 5),
    threshold: at(THRESHOLD_SHARE),
    easy: [at(EASY_SHARES[0]), at(EASY_SHARES[1])],
  }
}

/** A 5K test time from 12:00 to 60:00 is believable; anything else is a typo. */
export const FIVE_K_SECONDS: Range = [12 * 60, 60 * 60]

/**
 * The 5K test the Training paces come from: the latest one logged as Done
 * with a time, on or before `today`. A later date wins, then a later edit.
 */
export function latestFiveKTest(logs: SessionLog[], today: LocalDate): SessionLog | null {
  let latest: SessionLog | null = null
  for (const log of logs) {
    if (log.sessionId !== '5k-test' || log.status !== 'done' || log.resultSeconds === null) continue
    if (daysBetween(log.date, today) < 0) continue
    if (!latest || log.date > latest.date || (log.date === latest.date && log.updatedAt > latest.updatedAt)) {
      latest = log
    }
  }
  return latest
}

/** The pace range a run effort asks for, in seconds per km, or null where it goes by feel. */
export function paceFor(effort: RunEffort, paces: TrainingPaces): Range | null {
  if ('feel' in effort) {
    // Deload Speed reps are "controlled": Threshold pace, never 5K pace.
    return effort.feel === 'controlled' ? [paces.threshold, paces.threshold] : null
  }
  const base: Record<PaceRef, Range> = {
    '5k': [paces.fiveK, paces.fiveK],
    threshold: [paces.threshold, paces.threshold],
    easy: paces.easy,
    goal: [GOAL_PACE, GOAL_PACE],
  }
  const faster = effort.secondsPerKmFaster ?? 0
  const [fast, slow] = base[effort.pace]
  return [fast - faster, slow - faster]
}

/** Seconds per km to a treadmill speed in `unit`, to the 0.1 a treadmill steps by. */
export function speedFor(secondsPerKm: number, unit: SpeedUnit): number {
  const kmh = 3600 / secondsPerKm
  return Math.round((unit === 'kmh' ? kmh : kmh / KM_PER_MILE) * 10) / 10
}

export const UNIT_LABEL: Record<SpeedUnit, string> = { kmh: 'km/h', mph: 'mph' }

/** 292 → "4:52" */
export function clock(seconds: number): string {
  const s = Math.round(seconds)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

/** "mm:ss" or "m:ss" to seconds; null for anything else. */
export function parseClock(text: string): number | null {
  const match = /^\s*(\d{1,2}):([0-5]\d)\s*$/.exec(text)
  return match ? Number(match[1]) * 60 + Number(match[2]) : null
}

/**
 * A pace range as the athlete reads it: "12.3 km/h · 1% incline" on the treadmill,
 * "4:52/km" outdoors. Ranges run slow to fast on the treadmill and fast to
 * slow outdoors, the way each is dialled.
 */
export function formatPace([fast, slow]: Range, environment: Environment, unit: SpeedUnit): string {
  if (environment === 'outdoor') {
    return fast === slow ? `${clock(fast)}/km` : `${clock(fast)}–${clock(slow)}/km`
  }
  const high = speedFor(fast, unit)
  const low = speedFor(slow, unit)
  const speed = low === high ? high.toFixed(1) : `${low.toFixed(1)}–${high.toFixed(1)}`
  return `${speed} ${UNIT_LABEL[unit]} · ${DEFAULT_INCLINE}% incline`
}

/** The exact target for a run effort, or null when it stays RPE only. */
export function runTarget(effort: RunEffort | undefined, context: RunContext): string | null {
  if (!effort || !context.paces) return null
  const pace = paceFor(effort, context.paces)
  return pace ? formatPace(pace, context.environment, context.unit) : null
}
