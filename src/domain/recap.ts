/**
 * After Race day: the race result and the Program recap.
 *
 * Pure, like Progress (ADR-0002): the race's finish time from its Session log,
 * and the whole Program in four numbers: the 5K tests first to last, the
 * Working weights first to now, Sessions done and the total Training load.
 */
import { daysBetween, type LocalDate } from './calendar'
import { logFor, RACE_SESSION_ID, type SessionLog } from './log'
import { fiveKProgress, GOAL_SECONDS, trainingLoad, weeklyCompletion, workingWeightRows } from './progress'
import type { Lane, LiftId, Program } from './program/types'
import type { WorkingWeightChange } from './weights'

/** Today shows the result and the recap from the day after Race day on. */
export function afterRace(program: Program, today: LocalDate): boolean {
  return daysBetween(program.raceDay, today) > 0
}

export type RaceResult =
  /** Not logged, or logged without a finish time: one question, the time. */
  | { state: 'ask'; log: SessionLog | null }
  | { state: 'finished'; log: SessionLog; seconds: number }
  | { state: 'skipped'; log: SessionLog }

export function raceResult(program: Program, logs: SessionLog[], today: LocalDate): RaceResult {
  const log = logFor(logs, program.weekCount, RACE_SESSION_ID)
  if (!log || daysBetween(log.date, today) < 0) return { state: 'ask', log: null }
  if (log.status === 'skipped') return { state: 'skipped', log }
  if (log.resultSeconds === null) return { state: 'ask', log }
  return { state: 'finished', log, seconds: log.resultSeconds }
}

export interface ProgramRecap {
  /** The first and the last 5K test, and whether the last one was sub-20; null with none logged. */
  fiveK: { first: { week: number; seconds: number }; last: { week: number; seconds: number }; sub20: boolean } | null
  /** Each lift with a Working weight: where calibration found it, where it is now. */
  workingWeights: { lift: LiftId; first: number; now: number }[]
  /** Required Sessions Done or Partial out of every one the Program prescribed, and Easy runs on top. */
  sessions: { done: number; required: number; easy: number }
  /** RPE × minutes of everything trained in the Program, and by lane: a 5K test in Speed, the race in HYROX. */
  trainingLoad: { total: number; byLane: Partial<Record<Lane, number>> }
}

export function programRecap(
  program: Program,
  logs: SessionLog[],
  changes: WorkingWeightChange[],
  today: LocalDate,
): ProgramRecap {
  const tests = fiveKProgress(program, logs, today).tests
  const first = tests[0]
  const last = tests.at(-1)
  const completion = weeklyCompletion(program, logs, today)
  return {
    fiveK:
      first && last
        ? {
            first: { week: first.week, seconds: first.seconds },
            last: { week: last.week, seconds: last.seconds },
            sub20: last.seconds < GOAL_SECONDS,
          }
        : null,
    workingWeights: workingWeightRows(changes).map((row) => ({ lift: row.lift, first: row.first.pounds, now: row.current })),
    sessions: {
      done: completion.reduce((sum, week) => sum + week.done, 0),
      required: program.phases
        .flatMap((p) => p.weeks)
        .flatMap((w) => w.sessions)
        .filter((s) => !s.optional).length,
      easy: completion
        .flatMap((week) => week.cells)
        .filter((c) => c.session.optional && (c.state === 'done' || c.state === 'partial')).length,
    },
    trainingLoad: trainingLoad(program, logs, today).reduce(
      (sum, week) => {
        for (const [lane, load] of Object.entries(week.byLane) as [Lane, number][]) {
          sum.byLane[lane] = (sum.byLane[lane] ?? 0) + load
        }
        return { ...sum, total: sum.total + week.total }
      },
      { total: 0, byLane: {} as Partial<Record<Lane, number>> },
    ),
  }
}

/**
 * The race logged in one step, from the finish time alone: Done on Race day,
 * its minutes from the time. A race already logged keeps everything but the
 * time, and counts as Done once it has one.
 */
export function finishLog(
  program: Program,
  existing: SessionLog | null,
  seconds: number,
  { id, updatedAt }: { id: string; updatedAt: string },
): SessionLog {
  if (existing) return { ...existing, status: 'done', resultSeconds: seconds, updatedAt }
  return {
    id,
    week: program.weekCount,
    sessionId: RACE_SESSION_ID,
    date: program.raceDay,
    status: 'done',
    minutes: Math.round(seconds / 60),
    rpe: null,
    notes: null,
    resultSeconds: seconds,
    environment: null,
    distanceMeters: null,
    intervals: [],
    sets: [],
    stations: [],
    updatedAt,
  }
}

/** A finish time as the results page prints it: "1:24:07", or "58:30" under the hour. */
export function finishClock(seconds: number): string {
  const s = Math.round(seconds)
  const mm = `${Math.floor((s % 3600) / 60)}`
  const ss = String(s % 60).padStart(2, '0')
  return s < 3600 ? `${mm}:${ss}` : `${Math.floor(s / 3600)}:${mm.padStart(2, '0')}:${ss}`
}

/**
 * "h:mm:ss", the same digits without colons ("12407", what the iPhone's
 * number pad types), or minutes past the hour ("84:07"). Null for anything else.
 */
export function parseFinish(text: string): number | null {
  const long = /^\s*(\d):?([0-5]\d):?([0-5]\d)\s*$/.exec(text)
  if (long) return Number(long[1]) * 3600 + Number(long[2]) * 60 + Number(long[3])
  const short = /^\s*(\d{1,3}):([0-5]\d)\s*$/.exec(text)
  return short ? Number(short[1]) * 60 + Number(short[2]) : null
}

/** Typed digits shown as a clock while they're typed: "124" → "1:24", "12407" → "1:24:07". */
export function finishInput(text: string): string {
  const digits = text.replace(/\D/g, '').slice(0, 5)
  if (digits.length < 3) return digits
  if (digits.length < 5) return `${digits.slice(0, -2)}:${digits.slice(-2)}`
  return `${digits[0]}:${digits.slice(1, 3)}:${digits.slice(3)}`
}
