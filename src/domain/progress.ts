/**
 * Progress: whether the Program is working, read from the Session logs.
 *
 * Pure, like the rest of the Coach (ADR-0002): the 5K tests against a planned
 * line to 20:00, each Week's completion by Session type, and Training load per
 * Week. The screen picks what to show; this decides what the numbers are.
 */
import { addDays, daysBetween, type LocalDate } from './calendar'
import { findWeek, programStart, weekOutcome } from './coach'
import { logFor, trained, type SessionLog } from './log'
import { GOAL_PACE, type Environment } from './paces'
import { SESSION_TYPES } from './program/describe'
import type { Lane, Program, Session } from './program/types'

/** Sub-20: the line every 5K test is measured against. */
export const GOAL_SECONDS = GOAL_PACE * 5

export interface FiveKPoint {
  week: number
  date: LocalDate
  seconds: number
  /** Null for a test logged before the Environment was recorded. */
  environment: Environment | null
}

export interface PlannedLine {
  from: { week: number; seconds: number }
  to: { week: number; seconds: number }
}

export interface FiveKProgress {
  /** Every 5K test logged as Done with a time, on or before today, oldest first. */
  tests: FiveKPoint[]
  /** From the baseline test to 20:00 by the last 5K test Week. Null until the baseline. */
  planned: PlannedLine | null
  /** 5K test Weeks still ahead with no test logged, each with where the planned line puts it. */
  upcoming: { week: number; seconds: number | null }[]
}

/** Where one Session of a past or current Week stands. */
export type CompletionState = 'done' | 'partial' | 'swapped' | 'skipped' | 'missed' | 'open'

export interface WeekCompletion {
  week: number
  cells: { session: Session; state: CompletionState }[]
  /** Required Sessions Done or Partial, and how many there are. The Optional session doesn't count. */
  done: number
  required: number
}

export interface WeekLoad {
  week: number
  /** RPE × minutes of what was trained in the Week, by lane: a 5K test in Speed, a Race simulation in HYROX. */
  byLane: Partial<Record<Lane, number>>
  total: number
}

/** The last 5K test Week: the planned line reaches 20:00 here. */
export function finalTestWeek(program: Program): number {
  const weeks = program.phases.flatMap((p) => p.weeks).filter((w) => w.fiveKTest)
  return weeks.length > 0 ? weeks[weeks.length - 1].number : program.weekCount
}

export function fiveKProgress(program: Program, logs: SessionLog[], today: LocalDate): FiveKProgress {
  const testWeeks = program.phases.flatMap((p) => p.weeks).filter((w) => w.fiveKTest)
  const tests: FiveKPoint[] = testWeeks.flatMap((week) => {
    const log = logFor(logs, week.number, '5k-test')
    if (!log || log.status !== 'done' || log.resultSeconds === null) return []
    if (daysBetween(log.date, today) < 0) return []
    return [{ week: week.number, date: log.date, seconds: log.resultSeconds, environment: log.environment }]
  })

  const baseline = tests[0]
  const last = finalTestWeek(program)
  const planned: PlannedLine | null =
    baseline && baseline.week < last
      ? { from: { week: baseline.week, seconds: baseline.seconds }, to: { week: last, seconds: GOAL_SECONDS } }
      : null

  const tested = new Set(tests.map((t) => t.week))
  const upcoming = testWeeks
    .filter((w) => !tested.has(w.number) && daysBetween(today, addDays(w.startDate, 6)) >= 0)
    .map((w) => ({ week: w.number, seconds: planned ? plannedAt(planned, w.number) : null }))

  return { tests, planned, upcoming }
}

/** The planned 5K time in `week`, on the straight line from the baseline to 20:00. */
export function plannedAt(line: PlannedLine, week: number): number {
  const share = (week - line.from.week) / (line.to.week - line.from.week)
  return Math.round(line.from.seconds + share * (line.to.seconds - line.from.seconds))
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
    const week = findWeek(program, number)
    if (!week) return []
    const missed = new Set(
      weekOutcome(program, week, logs, today)
        .skipped.filter((s) => s.by === 'coach')
        .map((s) => s.session.id),
    )
    const cells = week.sessions.map((session) => {
      const log = logFor(logs, number, session.id)
      const state: CompletionState = log ? log.status : missed.has(session.id) ? 'missed' : 'open'
      return { session, state }
    })
    const required = cells.filter((c) => !c.session.optional)
    return [
      {
        week: number,
        cells,
        done: required.filter((c) => c.state === 'done' || c.state === 'partial').length,
        required: required.length,
      },
    ]
  })
}

/**
 * Training load per Week so far: RPE × minutes of every Session trained,
 * counted in the Week it was done (a carried Key session counts where it
 * landed). A log without RPE or minutes adds nothing.
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
  fiveK: FiveKProgress
  completion: WeekCompletion[]
  load: WeekLoad[]
}

export function progress(program: Program, logs: SessionLog[], today: LocalDate): ProgressDay {
  return {
    fiveK: fiveKProgress(program, logs, today),
    completion: weeklyCompletion(program, logs, today),
    load: trainingLoad(program, logs, today),
  }
}
