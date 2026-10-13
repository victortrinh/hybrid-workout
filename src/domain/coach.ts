/**
 * The Coach: fixed rules that turn the Program into what to do today.
 *
 * Pure by design (ADR-0002): no I/O, no clock, no storage. Give it the
 * Program and today's date in America/Toronto and it answers the same way
 * every time, which is what makes it testable. Session logs, Pain reports and
 * Recovery data join the input as later rules need them.
 */
import { addDays, daysBetween, mondayOf, type LocalDate } from './calendar'
import type { Phase, PhaseId, Program, Session, Week } from './program/types'

export interface CoachInput {
  program: Program
  /** Today, as a calendar date in America/Toronto. */
  today: LocalDate
}

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
  /** The one Session to do today. Null before the Program starts and after it ends. */
  upNext: Session | null
}

export function coach({ program, today }: CoachInput): CoachDay {
  const position = positionOf(program, today)
  const shownWeek =
    position.kind === 'in-week' ? position.week : position.kind === 'before-start' ? 1 : null
  const week = shownWeek === null ? null : findWeek(program, shownWeek)

  return {
    today,
    raceDay: program.raceDay,
    daysToRace: daysBetween(today, program.raceDay),
    position,
    phases: program.phases.map((phase) => phaseProgress(phase, position)),
    week,
    upNext: position.kind === 'in-week' && week ? firstPlanned(week) : null,
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

/** For now, with nothing logged: the Bucket's first Session that isn't Optional. */
function firstPlanned(week: Week): Session | null {
  return week.sessions.find((s) => !s.optional) ?? null
}
