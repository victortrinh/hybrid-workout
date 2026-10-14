/**
 * The Coach: fixed rules that turn the Program into what to do today.
 *
 * Pure by design (ADR-0002): no I/O, no clock, no storage. Give it the
 * Program and today's date in America/Toronto and it answers the same way
 * every time, which is what makes it testable. Pain reports and Recovery
 * data join the input as later rules need them.
 */
import { addDays, daysBetween, mondayOf, type LocalDate } from './calendar'
import { logFor, trained, type LoggedStatus, type SessionLog } from './log'
import { latestFiveKTest, trainingPaces, type TrainingPaces } from './paces'
import type { Phase, PhaseId, Program, Session, SessionType, Week } from './program/types'

export interface CoachInput {
  program: Program
  /** Today, as a calendar date in America/Toronto. */
  today: LocalDate
  /** Every Session log, from any Week. */
  logs?: SessionLog[]
  /** A Session the athlete tapped in the Bucket to do instead of Up next. Counts only on its `date`. */
  picked?: PickedSession | null
}

export interface PickedSession {
  date: LocalDate
  week: number
  sessionId: string
}

/** Where a Session of the Bucket stands: Planned and Next until something is logged. */
export type BucketState = 'planned' | 'next' | LoggedStatus

export interface BucketEntry {
  session: Session
  state: BucketState
  /** The log behind a logged state; null while Planned or Next. */
  log: SessionLog | null
}

/** Why there is no Up next today. */
export type RestReason =
  /** Every Session in the Bucket is logged. */
  | { kind: 'week-done' }
  /** A Hard session was done yesterday, or already today, and the Week has room to wait a day. */
  | { kind: 'hard-yesterday' | 'hard-today' }
  /** Only Speed is left, and Strength or HYROX was done yesterday or today. */
  | { kind: 'speed-after-load' }
  /** What's left is pinned to a later day: the race. */
  | { kind: 'waiting'; session: Session; date: LocalDate }

/** Where today falls in the Program. */
export type ProgramPosition =
  | { kind: 'before-start'; startsOn: LocalDate; daysToStart: number }
  | {
      kind: 'in-week'
      week: number
      phase: PhaseId
      startDate: LocalDate
      endDate: LocalDate
      /** Including today: 7 on a Monday, 1 on a Sunday. */
      daysLeft: number
    }
  | { kind: 'finished' }

export interface PhaseProgress {
  id: PhaseId
  name: string
  firstWeek: number
  lastWeek: number
  /** 0 to 1: the share of the Phase's Weeks already behind today. */
  completion: number
  current: boolean
}

export interface CoachDay {
  today: LocalDate
  raceDay: LocalDate
  /** 0 on Race day, negative after it. */
  daysToRace: number
  position: ProgramPosition
  phases: PhaseProgress[]
  /**
   * The Week whose Bucket Today shows: the current Week, or Week 1 before the
   * Program starts. Null after the Program, or when that Week isn't encoded yet.
   */
  week: Week | null
  /** That Week's Sessions in display order, each with its state. Empty when there is no Week. */
  bucket: BucketEntry[]
  /** The one Session to do today. Null before the Program starts, after it ends, and on a rest day. */
  upNext: Session | null
  /** Why `upNext` is null while in a Week. */
  rest: RestReason | null
  /** The latest 5K test on or before today, which the Training paces come from. */
  fiveKTest: SessionLog | null
  /** Null before the baseline 5K test: until then every run is RPE only. */
  paces: TrainingPaces | null
}

export function coach({ program, today, logs = [], picked = null }: CoachInput): CoachDay {
  const position = positionOf(program, today)
  const shownWeek =
    position.kind === 'in-week' ? position.week : position.kind === 'before-start' ? 1 : null
  const week = shownWeek === null ? null : findWeek(program, shownWeek)

  const logged = week
    ? week.sessions.map((session) => ({ session, log: logFor(logs, week.number, session.id) }))
    : []
  const { upNext, rest } =
    position.kind === 'in-week' && week
      ? chooseUpNext({ program, week, logged, logs, today, picked, daysLeft: position.daysLeft })
      : { upNext: null, rest: null }
  const fiveKTest = latestFiveKTest(logs, today)

  return {
    today,
    raceDay: program.raceDay,
    daysToRace: daysBetween(today, program.raceDay),
    position,
    phases: program.phases.map((phase) => phaseProgress(phase, position)),
    week,
    bucket: logged.map(({ session, log }) => ({
      session,
      log,
      state: log ? log.status : session === upNext ? 'next' : 'planned',
    })),
    upNext,
    rest,
    fiveKTest,
    paces: fiveKTest?.resultSeconds ? trainingPaces(fiveKTest.resultSeconds) : null,
  }
}

/** Week 1's Monday: Race week's Monday, counted back `weekCount - 1` Weeks. */
export function programStart(program: Program): LocalDate {
  return addDays(mondayOf(program.raceDay), -7 * (program.weekCount - 1))
}

export function findWeek(program: Program, number: number): Week | null {
  for (const phase of program.phases) {
    const week = phase.weeks.find((w) => w.number === number)
    if (week) return week
  }
  return null
}

function positionOf(program: Program, today: LocalDate): ProgramPosition {
  const start = programStart(program)
  const offset = daysBetween(start, today)
  if (offset < 0) return { kind: 'before-start', startsOn: start, daysToStart: -offset }

  const week = Math.floor(offset / 7) + 1
  if (week > program.weekCount) return { kind: 'finished' }

  const startDate = addDays(start, (week - 1) * 7)
  return {
    kind: 'in-week',
    week,
    phase: phaseOfWeek(program, week).id,
    startDate,
    endDate: addDays(startDate, 6),
    daysLeft: 7 - (offset % 7),
  }
}

function phaseOfWeek(program: Program, week: number): Phase {
  const phase = program.phases.find((p) => week >= p.firstWeek && week <= p.lastWeek)
  if (!phase) throw new Error(`Week ${week} belongs to no Phase`)
  return phase
}

function phaseProgress(phase: Phase, position: ProgramPosition): PhaseProgress {
  const length = phase.lastWeek - phase.firstWeek + 1
  const weeksBehind =
    position.kind === 'before-start'
      ? 0
      : position.kind === 'finished'
        ? length
        : Math.min(length, Math.max(0, position.week - phase.firstWeek))
  return {
    id: phase.id,
    name: phase.name,
    firstWeek: phase.firstWeek,
    lastWeek: phase.lastWeek,
    completion: weeksBehind / length,
    current: position.kind === 'in-week' && position.phase === phase.id,
  }
}

// ---------------------------------------------------------------------------
// Up next and the spacing rules (docs/training-plan.md, "How a Week works").

/** Every Session type but the Easy run. */
export const isHard = (type: SessionType) => type !== 'easy'
/** The 5K test takes the Speed session's place, so it follows the Speed rule. */
const isSpeed = (type: SessionType) => type === 'speed' || type === '5k-test'
/** What makes the legs too heavy for Speed the next day. */
const isLoad = (type: SessionType) => type === 'strength' || type === 'hyrox' || type === 'race-simulation'

interface UpNextInput {
  program: Program
  week: Week
  logged: { session: Session; log: SessionLog | null }[]
  logs: SessionLog[]
  today: LocalDate
  picked: PickedSession | null
  /** Days left in the Week, including today. */
  daysLeft: number
}

/**
 * The rules, in order:
 * 1. A Session the athlete picked today wins, as long as it is still open.
 * 2. A Session pinned to today (Race day) is Up next.
 * 3. The Optional session waits until nothing else is left to do before
 *    Sunday (Race week's shakeout only waits for nothing but the race).
 * 4. Never Speed the day after Strength or HYROX (or later the same day).
 * 5. No Hard session the day after another (or a second one the same day) when
 *    the Week has room to rest today and still fit the Hard sessions left.
 * 6. Of what remains, the Session waiting longest; within a Week, Bucket order.
 */
function chooseUpNext({ program, week, logged, logs, today, picked, daysLeft }: UpNextInput): {
  upNext: Session | null
  rest: RestReason | null
} {
  const open = logged.filter((entry) => !entry.log).map((entry) => entry.session)
  if (open.length === 0) return { upNext: null, rest: { kind: 'week-done' } }

  if (picked && picked.date === today && picked.week === week.number) {
    const choice = open.find((s) => s.id === picked.sessionId)
    if (choice) return { upNext: choice, rest: null }
  }

  const pinnedToday = open.find((s) => s.date === today)
  if (pinnedToday) return { upNext: pinnedToday, rest: null }

  const available = open.filter((s) => !s.date)
  if (available.length === 0) {
    const pinned = open.find((s) => s.date)!
    return { upNext: null, rest: { kind: 'waiting', session: pinned, date: pinned.date! } }
  }
  const required = available.filter((s) => !s.optional)
  const pool = required.length > 0 ? required : available

  const yesterday = addDays(today, -1)
  const typesOn = (date: LocalDate) => trainedTypes(program, logs, date)
  const before = [...typesOn(yesterday), ...typesOn(today)]

  const allowed = before.some(isLoad) ? pool.filter((s) => !isSpeed(s.type)) : pool
  if (allowed.length === 0) return { upNext: null, rest: { kind: 'speed-after-load' } }

  const hardToday = typesOn(today).some(isHard)
  const hardYesterday = typesOn(yesterday).some(isHard)
  if (hardToday || hardYesterday) {
    const easy = allowed.filter((s) => !isHard(s.type))
    if (easy.length > 0) return { upNext: oldestWaiting(easy), rest: null }

    const hardLeft = available.filter((s) => isHard(s.type)).length
    // Resting today leaves `daysLeft - 1` days from tomorrow; tomorrow can't be Hard after a Hard today.
    if (hardLeft <= mostHardSessions(daysLeft - 1, hardToday)) {
      return { upNext: null, rest: { kind: hardToday ? 'hard-today' : 'hard-yesterday' } }
    }
  }

  return { upNext: oldestWaiting(allowed), rest: null }
}

/** Session types logged as Done or Partial on `date`, from any Week. */
function trainedTypes(program: Program, logs: SessionLog[], date: LocalDate): SessionType[] {
  return logs
    .filter((log) => log.date === date && trained(log))
    .flatMap((log) => findWeek(program, log.week)?.sessions.find((s) => s.id === log.sessionId)?.type ?? [])
}

/** The most Hard sessions `days` days can hold with none on consecutive days. */
function mostHardSessions(days: number, firstDayBlocked: boolean): number {
  return Math.max(0, Math.ceil((days - (firstDayBlocked ? 1 : 0)) / 2))
}

/**
 * Every open Session of a Week has waited since its Monday, so Bucket order
 * breaks the tie. Key sessions carried over from last Week will wait longer.
 */
function oldestWaiting(sessions: Session[]): Session {
  return sessions[0]
}
