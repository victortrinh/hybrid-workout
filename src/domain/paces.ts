/**
 * Training paces and run targets.
 *
 * Race run pace is the base: the mean of the four 1 km splits of the latest
 * Done Compromised run test, from the test's day on. Threshold pace is Race
 * run pace less 15 s/km and Easy pace Race run pace plus 60 to 90 s/km, the
 * Program's fixed offsets (training-plan.md, "Paces and treadmill"). Before
 * the first test, the Starting point's estimated 1 km split stands in for
 * the test, and the paces are marked as estimates. With neither, run
 * Prescriptions stay RPE only.
 *
 * Paces are seconds per km. Indoor runs read as treadmill speed, then the pace
 * per km, then the incline; Outdoor runs as pace per km alone.
 */
import type { LocalDate } from './calendar'
import type { SessionLog, StationLog } from './log'
import type { PaceRef, Range, RunEffort } from './program/types'

export const ENVIRONMENTS = ['indoor', 'outdoor'] as const
export type Environment = (typeof ENVIRONMENTS)[number]

export const SPEED_UNITS = ['kmh', 'mph'] as const
export type SpeedUnit = (typeof SPEED_UNITS)[number]

/** Treadmill incline when the Prescription doesn't say: 1% stands in for the air outdoors. */
export const DEFAULT_INCLINE = 1

/** Sub-22: 4:24 per km. Left for Progress until #164 replaces its 5K panel. */
export const GOAL_PACE = 264

export const KM_PER_MILE = 1.609344

export interface TrainingPaces {
  /** Seconds per km: the pace held between Stations, and the base of the others. */
  raceRun: number
  threshold: number
  /** Easy is a range: the faster end first. */
  easy: Range
  /** From the Starting point's estimated split, not a test. */
  estimate: boolean
}

/** What a run Prescription is resolved against. */
export interface RunContext {
  /** Null with no test and no estimate: then every run is RPE only. */
  paces: TrainingPaces | null
  environment: Environment
  unit: SpeedUnit
  /** The By-feel speeds last logged, for a Live run: hints beside the effort, never targets (ADR-0002). */
  logged?: LoggedSpeeds
}

/** The latest logged By-feel speeds, in seconds per km; null where none was ever logged. */
export interface LoggedSpeeds {
  hardPace: number | null
  recoveryPace: number | null
}

/** Threshold pace is Race run pace less this, in seconds per km. */
export const THRESHOLD_OFFSET = 15

/** Easy pace is Race run pace plus this range, in seconds per km. */
export const EASY_OFFSET: Range = [60, 90]

/** The Training paces a Race run pace gives, in seconds per km. */
export function trainingPaces(raceRun: number, { estimate = false } = {}): TrainingPaces {
  return {
    raceRun,
    threshold: raceRun - THRESHOLD_OFFSET,
    easy: [raceRun + EASY_OFFSET[0], raceRun + EASY_OFFSET[1]],
    estimate,
  }
}

/** A 1 km split between Stations from 2:30 to 10:00 is believable; anything else is a typo. */
export const SPLIT_SECONDS: Range = [150, 600]

/** The Compromised run test's id within its Week. */
export const RUN_TEST_SESSION_ID = 'compromised-run-test'

/** A Compromised run test is four rounds of a 1 km run and a Station. */
export const RUN_TEST_RUNS = 4

/** A Compromised run test's result, derived from its Station logs: none of it is stored. */
export interface RunTestResult {
  week: number
  date: LocalDate
  /** The four run splits in seconds per km, round 1 first. */
  splits: number[]
  /** Their mean, to the second: the Race run pace it sets. */
  raceRun: number
  /** The fourth split less the first, s/km: positive is slower at the end. */
  fade: number
}

/** The timed runs of a Session log, in round order, as seconds per km. */
function runPaces(stations: StationLog[]): number[] {
  return stations
    .filter((line) => line.part === 'run' && line.seconds !== null && line.meters !== null && line.meters > 0)
    .sort((a, b) => a.round - b.round)
    .map((line) => Math.round(line.seconds! / (line.meters! / 1000)))
}

/** The Fade of a log's runs: the last run's pace less the first's, in s/km; null under two timed runs. */
export function fade(stations: StationLog[]): number | null {
  const paces = runPaces(stations)
  return paces.length < 2 ? null : paces.at(-1)! - paces[0]
}

/** What a Compromised run test log says, or null unless it is a Done test with all four runs timed. */
export function runTestResult(log: SessionLog): RunTestResult | null {
  if (log.sessionId !== RUN_TEST_SESSION_ID || log.status !== 'done') return null
  const splits = runPaces(log.stations)
  if (splits.length !== RUN_TEST_RUNS) return null
  return {
    week: log.week,
    date: log.date,
    splits,
    raceRun: Math.round(splits.reduce((sum, s) => sum + s, 0) / splits.length),
    fade: splits.at(-1)! - splits[0],
  }
}

/** The latest Done Compromised run test on or before `today`, or null before the first. */
export function latestRunTest(logs: SessionLog[], today: LocalDate): RunTestResult | null {
  let latest: RunTestResult | null = null
  for (const log of logs) {
    if (log.date > today) continue
    const result = runTestResult(log)
    if (result && (!latest || result.date > latest.date || (result.date === latest.date && result.week > latest.week))) {
      latest = result
    }
  }
  return latest
}

/**
 * The Training paces today: from the latest Done Compromised run test, from
 * its day on; before the first, estimated from the Starting point's split;
 * or none.
 */
export function currentPaces(logs: SessionLog[], estimatedSplit: number | null, today: LocalDate): TrainingPaces | null {
  const test = latestRunTest(logs, today)
  if (test) return trainingPaces(test.raceRun)
  return estimatedSplit === null ? null : trainingPaces(estimatedSplit, { estimate: true })
}

/** An effort with no pace to hold, whatever the Training paces: "Hard, by feel". Controlled is Threshold. */
export const isByFeel = (effort: RunEffort) => 'feel' in effort && effort.feel !== 'controlled'

/** The pace range a run effort asks for, in seconds per km, or null where it goes by feel. */
export function paceFor(effort: RunEffort, paces: TrainingPaces): Range | null {
  if ('feel' in effort) {
    // Controlled reps are Threshold pace.
    return effort.feel === 'controlled' ? [paces.threshold, paces.threshold] : null
  }
  const base: Record<PaceRef, Range> = {
    'race-run': [paces.raceRun, paces.raceRun],
    threshold: [paces.threshold, paces.threshold],
    easy: paces.easy,
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

/** A treadmill console's distance unit: km on a km/h treadmill, mi on an mph one. */
export const DISTANCE_UNIT: Record<SpeedUnit, string> = { kmh: 'km', mph: 'mi' }

/** A console distance as typed in `unit`'s km or mi, to meters; null while empty. 3.1 mi → 4989. */
export function consoleMeters(distance: number, unit: SpeedUnit): number | null {
  if (!Number.isFinite(distance)) return null
  return Math.round(distance * (unit === 'kmh' ? 1000 : KM_PER_MILE * 1000))
}

/** Stored meters back to the console's km or mi, to the 0.01 it shows; NaN when there are none. */
export function consoleDistance(meters: number | null, unit: SpeedUnit): number {
  if (!meters) return Number.NaN
  return Math.round((meters / (unit === 'kmh' ? 1000 : KM_PER_MILE * 1000)) * 100) / 100
}

/** 292 → "4:52" */
export function clock(seconds: number): string {
  const s = Math.round(seconds)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

/**
 * "mm:ss" or "m:ss" to seconds, or the same digits without the colon
 * ("1945", "452"), which is what the iPhone's number pad can type. Null for anything else.
 */
export function parseClock(text: string): number | null {
  const match = /^\s*(\d{1,2}):?([0-5]\d)\s*$/.exec(text)
  return match ? Number(match[1]) * 60 + Number(match[2]) : null
}

/** Typed digits shown as a clock while they're typed: "1945" → "19:45", "45" stays "45". */
export function clockInput(text: string): string {
  const digits = text.replace(/\D/g, '').slice(0, 4)
  return digits.length < 3 ? digits : `${digits.slice(0, -2)}:${digits.slice(-2)}`
}

/** "4:52/km", or "5:51–6:26/km" for a range, fast to slow. */
function perKm([fast, slow]: Range): string {
  return fast === slow ? `${clock(fast)}/km` : `${clock(fast)}–${clock(slow)}/km`
}

/**
 * A pace range as the athlete reads it: "12.3 km/h · 4:52/km · 1% incline" on
 * the treadmill, so the belt can be set and still compared with the Program's
 * paces, and "4:52/km" outdoors. The speed runs slow to fast, the way the
 * belt is dialled; the pace per km always fast to slow.
 */
export function formatPace(range: Range, environment: Environment, unit: SpeedUnit): string {
  if (environment === 'outdoor') return perKm(range)
  const high = speedFor(range[0], unit)
  const low = speedFor(range[1], unit)
  const speed = low === high ? high.toFixed(1) : `${low.toFixed(1)}–${high.toFixed(1)}`
  return `${speed} ${UNIT_LABEL[unit]} · ${perKm(range)} · ${DEFAULT_INCLINE}% incline`
}

/** The exact target for a run effort, or null when it stays RPE only. */
export function runTarget(effort: RunEffort | undefined, context: RunContext): string | null {
  if (!effort || !context.paces) return null
  const pace = paceFor(effort, context.paces)
  return pace ? formatPace(pace, context.environment, context.unit) : null
}
