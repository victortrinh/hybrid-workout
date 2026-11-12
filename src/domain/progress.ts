/**
 * Progress: whether the Program is working, read from the Session logs.
 *
 * Pure, like the rest of the Coach (ADR-0002): the Projected finish, the
 * Station bests at race volume, the Race run pace from test to test, each
 * Week's completion by Session type, Training load per Week, the Working
 * weights, recent recovery and the Race simulation times. The screen picks what to show; this decides
 * what the numbers are.
 */
import { addDays, daysBetween, type LocalDate } from './calendar'
import { findWeek, programStart, weekOutcome } from './coach'
import { logFor, offeredSessions, trained, type SessionLog } from './log'
import { runTestResult, type RunTestResult } from './paces'
import { SESSION_TYPES } from './program/describe'
import { LIFTS, type Lane, type LiftId, type Program, type Session, type Station, type StationId } from './program/types'
import { ROXZONE_SECONDS } from './racePlan'
import { nightOf, type RecoveryNight } from './recovery'
import { stationBest, stationReach, type StationReach } from './stations'
import type { WorkingWeightChange } from './weights'

/** Where one Session of a past or current Week stands. Skipped with days left is still open. */
export type CompletionState = 'done' | 'partial' | 'swapped' | 'skipped' | 'missed' | 'open'

export interface WeekCompletion {
  week: number
  cells: { session: Session; state: CompletionState }[]
  /** Required Sessions Done or Partial, and how many there are. The Optional session doesn't count. */
  done: number
  required: number
  /** Required Sessions Skipped or missed once their Week is over. The Optional session is never a miss. */
  missed: number
}

export interface WeekLoad {
  week: number
  /** RPE × minutes of what was trained in the Week, by lane: a Race simulation in HYROX. */
  byLane: Partial<Record<Lane, number>>
  total: number
}

/** The Week a date falls in, or null outside the Program. */
export function weekOf(program: Program, date: LocalDate): number | null {
  const offset = daysBetween(programStart(program), date)
  const week = Math.floor(offset / 7) + 1
  return offset < 0 || week > program.weekCount ? null : week
}

/** Weeks 1 to today's (all of them once the Program is over); none before it starts. */
function weeksSoFar(program: Program, today: LocalDate): number[] {
  const offset = daysBetween(programStart(program), today)
  if (offset < 0) return []
  const last = Math.min(program.weekCount, Math.floor(offset / 7) + 1)
  return Array.from({ length: last }, (_, i) => i + 1)
}

/** Each Week so far, Session by Session in Bucket order. */
export function weeklyCompletion(program: Program, logs: SessionLog[], today: LocalDate): WeekCompletion[] {
  return weeksSoFar(program, today).flatMap((number) => {
    const listed = findWeek(program, number)
    if (!listed) return []
    const week = offeredSessions(program, listed, logs)
    // Misses as the Coach counts them: a Skipped Session isn't one while its Week has days left.
    const missed = new Set(weekOutcome(program, week, logs, today).skipped.map((s) => s.session.id))
    const cells = week.sessions.map((session) => {
      const log = logFor(logs, number, session.id)
      const state: CompletionState = !log
        ? missed.has(session.id)
          ? 'missed'
          : 'open'
        : log.status === 'skipped' && !session.optional && !missed.has(session.id)
          ? 'open'
          : log.status
      return { session, state }
    })
    const required = cells.filter((c) => !c.session.optional)
    return [
      {
        week: number,
        cells,
        done: required.filter((c) => c.state === 'done' || c.state === 'partial').length,
        required: required.length,
        missed: required.filter((c) => c.state === 'skipped' || c.state === 'missed').length,
      },
    ]
  })
}

/**
 * Training load per Week so far: RPE × minutes of every Session trained,
 * counted in the Week it was done (a Late session counts where it landed).
 * A log without RPE or minutes adds nothing.
 */
export function trainingLoad(program: Program, logs: SessionLog[], today: LocalDate): WeekLoad[] {
  const weeks = weeksSoFar(program, today)
  const loads = new Map<number, WeekLoad>(weeks.map((week) => [week, { week, byLane: {}, total: 0 }]))
  // One log stands for each Session: the latest edit.
  const standing = logs.filter((log) => logFor(logs, log.week, log.sessionId) === log)
  for (const log of standing) {
    if (!trained(log) || log.rpe === null || log.minutes === null) continue
    if (daysBetween(log.date, today) < 0) continue
    const load = loads.get(weekOf(program, log.date) ?? 0)
    const session = findWeek(program, log.week)?.sessions.find((s) => s.id === log.sessionId)
    if (!load || !session) continue
    const lane = SESSION_TYPES[session.type].lane
    const value = log.rpe * log.minutes
    load.byLane[lane] = (load.byLane[lane] ?? 0) + value
    load.total += value
  }
  return [...loads.values()]
}

export interface ProgressDay {
  projected: ProjectedFinish
  lanes: RaceLane[]
  bests: StationBest[]
  raceRun: RunTestResult[]
  completion: WeekCompletion[]
  load: WeekLoad[]
}

export function progress(program: Program, logs: SessionLog[], today: LocalDate): ProgressDay {
  const bests = stationBests(program, logs, today)
  return {
    projected: projectedFinish(program, logs, today, bests),
    lanes: raceLanes(program, logs, today),
    bests,
    raceRun: raceRunSeries(logs, today),
    completion: weeklyCompletion(program, logs, today),
    load: trainingLoad(program, logs, today),
  }
}

// ---------------------------------------------------------------------------
// Working weights

export interface WorkingWeightRow {
  lift: LiftId
  /** What the calibration found, and in which Week. */
  first: { week: number; pounds: number }
  current: number
  /** The latest time it was set or moved: the calibration itself until the Coach moves it. */
  last: WorkingWeightChange
  /** What it was before that last change; null when the last change was a calibration. */
  before: number | null
}

/**
 * Each lift with a Working weight, in the order the Program names them:
 * where calibration put it, where it is now, and why it last moved.
 */
export function workingWeightRows(changes: WorkingWeightChange[]): WorkingWeightRow[] {
  return LIFTS.flatMap((lift) => {
    const mine = changes.filter((c) => c.lift === lift)
    const first = mine.find((c) => c.reason === 'calibration')
    const last = mine.at(-1)
    if (!first || !last) return []
    const before = last.reason === 'calibration' ? null : (mine.at(-2)?.pounds ?? null)
    return [{ lift, first: { week: first.week, pounds: first.pounds }, current: last.pounds, last, before }]
  })
}

// ---------------------------------------------------------------------------
// Recovery

/** The nights the Recovery chart shows, ending with last night. */
export const RECOVERY_NIGHTS = 14

/** The last 14 mornings to today, oldest first, each with its night if the Shortcut sent one. */
export function recoveryTrend(nights: RecoveryNight[], today: LocalDate): { date: LocalDate; night: RecoveryNight | null }[] {
  return Array.from({ length: RECOVERY_NIGHTS }, (_, i) => {
    const date = addDays(today, i - RECOVERY_NIGHTS + 1)
    return { date, night: nightOf(nights, date) }
  })
}

// ---------------------------------------------------------------------------
// The Projected finish, the Station bests and the Race run pace

/** The transitions the Projected finish allows: the race plan's Roxzone, six minutes. */
export const TRANSITION_SECONDS = ROXZONE_SECONDS

/** One log stands for each Session (the latest edit), counted from the day it was done. */
const standingBy = (logs: SessionLog[], today: LocalDate) =>
  logs.filter((log) => logFor(logs, log.week, log.sessionId) === log && daysBetween(log.date, today) >= 0)

export interface StationBest {
  station: StationId
  /** The fastest time at race volume and Race load, and the Week it was logged in; null before any. */
  seconds: number | null
  week: number | null
}

/** The eight Stations in race order, each with its Station best at full Station volume by today. */
export function stationBests(program: Program, logs: SessionLog[], today: LocalDate): StationBest[] {
  const standing = standingBy(logs, today)
  return (Object.values(program.stations) as Station[])
    .sort((a, b) => a.order - b.order)
    .map(({ id, raceLoad }) => {
      const volume = { meters: raceLoad.meters, reps: raceLoad.reps }
      const seconds = stationBest(standing, id, volume)
      if (seconds === null) return { station: id, seconds: null, week: null }
      // The earliest log that holds the best: where it was first set.
      const set = standing
        .filter((log) => trained(log) && log.stations.some((l) => l.part === id && l.seconds === seconds))
        .sort((a, b) => a.date.localeCompare(b.date))[0]
      return { station: id, seconds, week: set?.week ?? null }
    })
}

/** Every Done Compromised run test by today with its four runs timed, oldest first: Race run pace from test to test. */
export function raceRunSeries(logs: SessionLog[], today: LocalDate): RunTestResult[] {
  return standingBy(logs, today)
    .flatMap((log) => runTestResult(log) ?? [])
    .sort((a, b) => a.date.localeCompare(b.date) || a.week - b.week)
}

export interface ProjectedFinish {
  /** The Race run pace of the latest Compromised run test; null before the first. */
  raceRun: { secondsPerKm: number; week: number } | null
  /** Stations with no best at full Station volume yet, in race order. */
  missing: StationId[]
  /** Null while a Station best or the Race run pace is missing: the projection is never invented. */
  projection: {
    /** The eight Station bests at full volume. */
    stations: number
    /** Eight 1 km runs at Race run pace. */
    running: number
    transitions: number
    solo: number
    /** Half the Station part, every run and the same transitions: both partners run every 1 km. */
    doubles: number
  } | null
}

/**
 * The solo finish the Coach projects: the eight Station bests at full
 * Station volume, eight runs at Race run pace and six minutes of
 * transitions, with the Doubles share beside it.
 */
export function projectedFinish(
  program: Program,
  logs: SessionLog[],
  today: LocalDate,
  bests: StationBest[] = stationBests(program, logs, today),
): ProjectedFinish {
  const latest = raceRunSeries(logs, today).at(-1)
  const raceRun = latest ? { secondsPerKm: latest.raceRun, week: latest.week } : null
  const missing = bests.filter((b) => b.seconds === null).map((b) => b.station)
  if (!raceRun || missing.length > 0) return { raceRun, missing, projection: null }
  const stations = bests.reduce((sum, b) => sum + b.seconds!, 0)
  const running = 8 * raceRun.secondsPerKm
  return {
    raceRun,
    missing,
    projection: {
      stations,
      running,
      transitions: TRANSITION_SECONDS,
      solo: stations + running + TRANSITION_SECONDS,
      doubles: stations / 2 + running + TRANSITION_SECONDS,
    },
  }
}

/** One lane of the race: the eight 1 km runs, or a Station. */
export type RaceLane =
  | {
      leg: 'run'
      /** The Race run pace of the latest Compromised run test; null before the first. */
      secondsPerKm: number | null
      week: number | null
    }
  | {
      leg: StationId
      /** How much of race volume has been timed in one go at Race load; null before any. At a share of 1, the Station best. */
      reach: StationReach | null
    }

/**
 * The race the Projected finish is waiting on, in lanes: the runs first,
 * then the eight Stations in race order, each as far as it has been timed
 * toward race volume. A lane is full once it gives the projection its
 * number; nothing short of full is stretched into one.
 */
export function raceLanes(program: Program, logs: SessionLog[], today: LocalDate): RaceLane[] {
  const standing = standingBy(logs, today)
  const latest = raceRunSeries(logs, today).at(-1)
  return [
    { leg: 'run', secondsPerKm: latest?.raceRun ?? null, week: latest?.week ?? null },
    ...(Object.values(program.stations) as Station[])
      .sort((a, b) => a.order - b.order)
      .map(({ id }): RaceLane => ({ leg: id, reach: stationReach(standing, id) })),
  ]
}

/** How many of the nine lanes are full: the Race run pace and each Station best. */
export const lanesFull = (lanes: RaceLane[]): number =>
  lanes.filter((l) => (l.leg === 'run' ? l.secondsPerKm !== null : l.reach?.share === 1)).length

/** The Projected finish in a line: its Solo time and Doubles share, or how many of the nine lanes are full. */
export type FinishSoFar = { solo: number; doubles: number } | { lanesFull: number }

/**
 * Where the Projected finish stands today, in the fewest numbers: the time
 * once all nine lanes are full, else the count of full lanes. Null before
 * any lane is full, when there is nothing to say yet.
 */
export function finishSoFar(program: Program, logs: SessionLog[], today: LocalDate): FinishSoFar | null {
  const { projection } = projectedFinish(program, logs, today)
  if (projection) return { solo: projection.solo, doubles: projection.doubles }
  const full = lanesFull(raceLanes(program, logs, today))
  return full > 0 ? { lanesFull: full } : null
}

// ---------------------------------------------------------------------------
// HYROX Stations

export interface RaceSimulationTimes {
  week: number
  date: LocalDate
  /** Each Station's split, where it was timed. */
  stations: Partial<Record<StationId, number>>
}

/** A Station's own split in a HYROX round, with what it was split over: rounds change volume Week to Week. */
export interface HyroxSplit {
  week: number
  date: LocalDate
  round: number
  seconds: number
  meters: number | null
  reps: number | null
}

export interface StationTimes {
  /** Every Race simulation trained with a Station timed, oldest first. */
  simulations: RaceSimulationTimes[]
  /** Each Station's latest split in a HYROX round, where one was timed. */
  hyrox: Partial<Record<StationId, HyroxSplit>>
  /** The first Race simulation Week, and the day it starts; null when the Program has none. */
  firstSimulation: { week: number; startDate: LocalDate } | null
}

/**
 * Station times from what was trained by today: each Race simulation's
 * splits, and from HYROX sessions, each Station's latest split. A round
 * logged before its legs were timed has only the round's time, run included,
 * so it is never passed off as a Station split.
 */
export function stationTimes(program: Program, logs: SessionLog[], today: LocalDate): StationTimes {
  const simulations: RaceSimulationTimes[] = []
  const hyrox: Partial<Record<StationId, HyroxSplit>> = {}
  const standing = logs
    .filter((log) => logFor(logs, log.week, log.sessionId) === log)
    .filter((log) => trained(log) && log.stations.length > 0 && daysBetween(log.date, today) >= 0)
    .sort((a, b) => a.date.localeCompare(b.date) || a.week - b.week)

  for (const log of standing) {
    const type = findWeek(program, log.week)?.sessions.find((s) => s.id === log.sessionId)?.type
    if (type === 'race-simulation') {
      const times: Partial<Record<StationId, number>> = {}
      for (const line of log.stations) {
        if (line.part !== 'run' && line.part !== 'round' && line.seconds !== null) times[line.part] = line.seconds
      }
      if (Object.keys(times).length > 0) simulations.push({ week: log.week, date: log.date, stations: times })
    } else if (type === 'hyrox') {
      for (const line of log.stations) {
        if (line.part === 'run' || line.part === 'round' || line.seconds === null) continue
        hyrox[line.part] = { week: log.week, date: log.date, round: line.round, seconds: line.seconds, meters: line.meters, reps: line.reps }
      }
    }
  }

  const first = program.phases.flatMap((p) => p.weeks).find((w) => w.raceSimulation)
  return { simulations, hyrox, firstSimulation: first ? { week: first.number, startDate: first.startDate } : null }
}
