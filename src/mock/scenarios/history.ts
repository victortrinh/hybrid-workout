/**
 * Writes a scenario's history the way the app would have: each Session log
 * built from its Prescription by the Live session code, so Strength sessions
 * carry sets at the Working weight the Coach would have given, HYROX sessions
 * carry their rounds, and interval sessions carry a rep for each rep.
 */
import { localDate, type LocalDate } from '../../domain/calendar'
import { findWeek } from '../../domain/coach'
import { DEFAULT_EQUIPMENT, equip, type Equipment } from '../../domain/equipment'
import { startLifts } from '../../domain/lifts'
import { liveBlocks, liveTarget, startRun, stationLogs } from '../../domain/live'
import type { IntervalLog, LoggedStatus, SessionLog } from '../../domain/log'
import type { PainArea, PainReport } from '../../domain/pain'
import { latestFiveKTest, trainingPaces, type Environment } from '../../domain/paces'
import { program } from '../../domain/program/program'
import type { LiftId, Session, SessionType } from '../../domain/program/types'
import { DEFAULT_SETTINGS, environmentOn } from '../../domain/settings'
import type { Decision, SuggestionDecision } from '../../domain/suggestion'
import { strengthState } from '../../domain/weights'

/** Days after Monday a Week's Sessions fall on, in Bucket order: never two Hard sessions back to back. */
const HARD_DAYS = [0, 2, 4, 6]

/** Each 5K test's time when a scenario doesn't say: 23:00 at baseline down to 19:55. */
const FIVE_K: Record<number, number> = { 2: 1380, 9: 1335, 17: 1265, 25: 1195 }

/** Where a calibration ramps to, RPE 7: the athlete's Working weights in Week 1. */
const CALIBRATED: Record<LiftId, number> = {
  'back-squat': 185,
  'romanian-deadlift': 135,
  'bulgarian-split-squat': 40,
  'single-leg-calf-raise': 35,
  'seated-calf-raise': 70,
  'standing-calf-raise-machine': 140,
  'seated-calf-raise-machine': 90,
}

/** What a Session of each type usually feels like overall. */
const RPE: Record<SessionType, number> = {
  speed: 8,
  strength: 7,
  threshold: 7,
  hyrox: 8,
  easy: 4,
  '5k-test': 10,
  'race-simulation': 9,
}

export interface LogOptions {
  minutes?: number
  rpe?: number
  notes?: string
  /** A 5K test's time. */
  resultSeconds?: number
  environment?: Environment
  /** Strength: each set's RPE. 7, the default, moves a Working weight up; 8 holds it; 9 counts toward a reduction. */
  setRpe?: number
  /** Strength: leave a Working weight Suggestion from this log open instead of accepting it. */
  undecided?: boolean
  /** Interval reps missed, from the end: run slower than the target. */
  missedReps?: number
  /** Seconds per round, or per run and Station of a Race simulation. Defaults by Session type. */
  splitSeconds?: number
}

export interface History {
  logs: SessionLog[]
  decisions: SuggestionDecision[]
  painReports: PainReport[]
  /** Logs a Program Session. Partial does about two thirds of it. */
  log(week: number, sessionId: string, date: string, status?: LoggedStatus, options?: LogOptions): History
  /**
   * Every Session of `week` but the Optional one Done, in Bucket order, a day
   * apart (Monday, Wednesday, Friday, Sunday); with `optional`, the Easy run
   * on Saturday. `skip` logs those Skipped, `partial` Partial.
   */
  week(week: number, options?: { optional?: boolean; skip?: string[]; partial?: string[] }): History
  decide(id: string, decision: Decision, date: string): History
  pain(date: string, score: number, area: PainArea | null, at?: { week: number; sessionId: string }): History
}

/** A history for the Program, done in a gym with `equipment`. */
export function history(equipment: readonly Equipment[] = DEFAULT_EQUIPMENT): History {
  const self: History = {
    logs: [],
    decisions: [],
    painReports: [],
    log(week, sessionId, date, status = 'done', options = {}) {
      const session = findWeek(program, week)?.sessions.find((s) => s.id === sessionId)
      if (!session) throw new Error(`Week ${week} has no Session ${sessionId}`)
      const day = localDate(date)
      const log = build(equip(session, equipment), week, day, status, options, self)
      if (self.logs.some((l) => l.id === log.id)) throw new Error(`Logged twice: Week ${week} ${sessionId}`)
      self.logs.push(log)
      if (session.type === 'strength' && !options.undecided) acceptIncreases(self, log)
      return self
    },
    week(week, { optional = false, skip = [], partial = [] } = {}) {
      const { startDate, sessions } = findWeek(program, week)!
      const status = (id: string) => (skip.includes(id) ? 'skipped' : partial.includes(id) ? 'partial' : 'done')
      sessions
        .filter((s) => !s.optional && !s.date)
        .forEach((s, i) => self.log(week, s.id, addDaysIso(startDate, HARD_DAYS[i]), status(s.id)))
      const easy = sessions.find((s) => s.optional && !s.date)
      if (optional && easy) self.log(week, easy.id, addDaysIso(startDate, 5), status(easy.id))
      return self
    },
    decide(id, decision, date) {
      self.decisions = self.decisions.filter((d) => d.id !== id)
      self.decisions.push({ id, decision, date: localDate(date), updatedAt: `${date}T21:00:00.000Z` })
      return self
    },
    pain(date, score, area, at) {
      const n = self.painReports.length + 1
      self.painReports.push({
        id: `mock-pain-${date}-${n}`,
        date: localDate(date),
        score,
        area,
        week: at?.week ?? null,
        sessionId: at?.sessionId ?? null,
        updatedAt: `${date}T${String(10 + n).padStart(2, '0')}:00:00.000Z`,
      })
      return self
    },
  }
  return self
}

function build(
  session: Session,
  week: number,
  date: LocalDate,
  status: LoggedStatus,
  options: LogOptions,
  so: History,
): SessionLog {
  const base: SessionLog = {
    id: `mock-w${week}-${session.id}`,
    week,
    sessionId: session.id,
    date,
    status,
    minutes: null,
    rpe: null,
    notes: options.notes ?? null,
    resultSeconds: null,
    environment: null,
    distanceMeters: null,
    intervals: [],
    sets: [],
    stations: [],
    // Early evening in Toronto, after work.
    updatedAt: `${date}T23:00:00.000Z`,
  }
  if (status === 'skipped') return base
  const partial = status === 'partial'
  const minutes = options.minutes ?? Math.round(session.minutes * (partial ? 0.65 : 1))
  const done = { ...base, minutes, rpe: options.rpe ?? RPE[session.type] - (partial ? 1 : 0) }
  // A Swapped Session was something else entirely: no sets or reps from this one.
  if (status === 'swapped') return { ...done, rpe: options.rpe ?? 5 }

  if (session.type === 'strength') {
    const { weights } = strengthState(program, so.logs, so.decisions, date)
    const lifts = startLifts({ week, session, date, weights }, 0)
    const kept = partial ? Math.max(1, Math.ceil(lifts.exercises.length * 0.6)) : lifts.exercises.length
    const sets = lifts.sets.slice(0, kept).flatMap((sets, exercise) => {
      const { lift, calibrate } = lifts.exercises[exercise]
      return sets.map((s, i) => {
        // A calibration ramps up, set by set, to the load that feels like RPE 7.
        const ramp = calibrate && lift ? CALIBRATED[lift] - 20 * (sets.length - 1 - i) : null
        return {
          exercise,
          set: i + 1,
          lift,
          pounds: ramp === null ? s.pounds : Math.max(5, ramp),
          reps: s.reps,
          rpe: calibrate ? (i === sets.length - 1 ? 7 : 6) : (options.setRpe ?? 7),
        }
      })
    })
    return { ...done, sets }
  }

  const environment = options.environment ?? environmentOn(date, DEFAULT_SETTINGS)
  const blocks = liveBlocks(session)

  if (session.type === 'hyrox' || session.type === 'race-simulation') {
    const timed = blocks.map((b, i) => ({ b, i })).filter(({ b }) => b.round !== null)
    const rounds = Math.max(...timed.map(({ b }) => b.round!))
    const reached = partial ? Math.ceil(rounds * 0.6) : rounds
    const seconds = (kind: string) =>
      options.splitSeconds ?? (kind === 'round' ? 540 : kind === 'distance' ? 285 : 260)
    const splits = timed.filter(({ b }) => b.round! <= reached).map(({ b, i }) => ({ block: i, seconds: seconds(b.kind) }))
    const live = { ...startRun({ week, session, date, environment }, 0), splits }
    return { ...done, environment, stations: stationLogs(live) }
  }

  const context = { paces: paces(so.logs, date), environment, unit: 'kmh' as const }
  const reps = blocks.map((b, block) => ({ b, block })).filter(({ b }) => b.rep !== null)
  const kept = partial ? reps.slice(0, Math.ceil(reps.length * 0.6)) : reps
  const missed = options.missedReps ?? 0
  const intervals: IntervalLog[] = kept.map(({ b, block }, i) => {
    const targetPace = liveTarget(b, context)?.pace ?? null
    const held = i < kept.length - missed
    return { block, rep: b.rep!, targetPace, held, actualPace: held || targetPace === null ? null : targetPace + 8 }
  })
  return {
    ...done,
    environment,
    intervals,
    resultSeconds: session.type === '5k-test' && status === 'done' ? (options.resultSeconds ?? FIVE_K[week] ?? 1380) : null,
  }
}

const paces = (logs: SessionLog[], date: LocalDate) => {
  const test = latestFiveKTest(logs, date)
  return test?.resultSeconds ? trainingPaces(test.resultSeconds) : null
}

/** The athlete accepted every Working weight going up: the Progress table climbs Week by Week. */
function acceptIncreases(so: History, log: SessionLog) {
  const { suggestions } = strengthState(program, so.logs, so.decisions, log.date)
  for (const s of suggestions) {
    if (s.week === log.week && s.decision === 'open' && s.to.pounds > s.from.pounds) so.decide(s.id, 'accepted', log.date)
  }
}

export function addDaysIso(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10)
}
