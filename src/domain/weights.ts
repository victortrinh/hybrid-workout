/**
 * Working weights (training-plan.md, Strength): found by calibration, then
 * moved by the Coach from each Strength session's logged sets.
 *
 * Pure like the rest of the Coach. Nothing is stored but the sets and the
 * athlete's decisions: every Working weight is replayed from the logs, oldest
 * first, each time it's asked for. A calibration sets a Working weight
 * outright, since the athlete picked those loads. Every change after that is a
 * Suggestion, and only an accepted one moves the weight.
 */
import { daysBetween, type LocalDate } from './calendar'
import { trained, type SessionLog, type SetLog } from './log'
import type { LiftId, Prescription, Program, Range, Session } from './program/types'
import {
  decisionFor,
  workingWeightId,
  type SuggestionDecision,
  type WorkingWeightReason,
  type WorkingWeightSuggestion,
} from './suggestion'

export type WorkingWeights = Partial<Record<LiftId, number>>

/** Pounds rounded to the nearest 5 lb, the smallest step in the gym. */
export const roundToFive = (pounds: number) => Math.round(pounds / 5) * 5

type Sets = Extract<Prescription, { kind: 'sets' }>

/** The RPE a calibration ramps to, and the most a set may feel for the Working weight to go up. */
export const CALIBRATION_RPE = 7
export const EASY_RPE = 7
/** A set this hard holds the Working weight where it is. */
export const HOLD_RPE = 9
/** Holds in a row before the Coach suggests going lighter. */
export const HOLDS_TO_REDUCE = 2

/** Calves go up by a share of the load; everything else by the smallest plate step. */
const CALVES: readonly LiftId[] = [
  'single-leg-calf-raise',
  'seated-calf-raise',
  'standing-calf-raise-machine',
  'seated-calf-raise-machine',
]
const STEP = 5
const CALF_PERCENT = 5
const REDUCE_PERCENT = 5
/** The Taper's light technique sets: well under the Working weight. */
const LIGHT_PERCENT = 60

export interface WorkingWeightChange {
  lift: LiftId
  /** The Strength session's Week and day. */
  week: number
  date: LocalDate
  pounds: number
  reason: 'calibration' | WorkingWeightReason
}

export interface StrengthState {
  /** Each lift's Working weight now; a lift without one is found in its next Strength session. */
  weights: WorkingWeights
  /** Every time a Working weight was set or moved, oldest first. */
  changes: WorkingWeightChange[]
  /**
   * Each lift's latest Suggestion, while its log is still the lift's latest:
   * a Strength session logged since lets an undecided one lapse.
   */
  suggestions: WorkingWeightSuggestion[]
}

/** Every lift's Working weight on `today`, replayed from the Strength sessions logged by then. */
export function strengthState(
  program: Program,
  logs: SessionLog[],
  decisions: SuggestionDecision[],
  today: LocalDate,
): StrengthState {
  const weights: WorkingWeights = {}
  const changes: WorkingWeightChange[] = []
  const latest = new Map<LiftId, WorkingWeightSuggestion>()
  const holds = new Map<LiftId, number[]>()

  for (const { log, session } of strengthLogs(program, logs, today)) {
    for (const [lift, sets] of byLift(log.sets)) {
      const rx = liftPrescription(session, lift)
      if (!rx || !('lift' in rx.load)) continue
      const current = weights[lift]
      latest.delete(lift)

      if (rx.load.kind === 'find-working-weight' || (rx.load.kind === 'working-weight' && current === undefined)) {
        weights[lift] = calibrated(sets)
        changes.push({ lift, week: log.week, date: log.date, pounds: weights[lift], reason: 'calibration' })
        holds.delete(lift)
        continue
      }
      if (rx.load.kind !== 'working-weight' || current === undefined) continue

      const outcome = judge(sets, rx, current, log.status === 'done')
      let change: { reason: WorkingWeightReason; to: number; weeks: number[] } | null = null
      if (outcome === 'increase') {
        holds.delete(lift)
        change = { reason: 'all-reps-easy', to: current + increase(lift, current), weeks: [log.week] }
      } else if (outcome === 'hold') {
        const row = [...(holds.get(lift) ?? []), log.week]
        if (row.length >= HOLDS_TO_REDUCE) {
          holds.delete(lift)
          change = { reason: 'two-holds', to: reduced(current), weeks: row }
        } else {
          holds.set(lift, row)
        }
      } else {
        holds.delete(lift)
      }
      if (!change) continue

      const id = workingWeightId(lift, log.week)
      const decided = decisionFor(decisions, id)
      const suggestion: WorkingWeightSuggestion = {
        id,
        kind: 'working-weight',
        week: log.week,
        sessionId: log.sessionId,
        lift,
        date: log.date,
        from: { pounds: current },
        to: { pounds: change.to },
        trigger: {
          reason: change.reason,
          weeks: change.weeks,
          sets: sets.length,
          reps: Math.min(...sets.map((s) => s.reps)),
          pounds: Math.min(...sets.map((s) => s.pounds ?? 0)),
          topRpe: Math.max(...sets.map((s) => s.rpe)),
        },
        decision: decided?.decision ?? 'open',
        decidedOn: decided?.date ?? null,
      }
      latest.set(lift, suggestion)
      if (suggestion.decision === 'accepted') {
        weights[lift] = change.to
        changes.push({ lift, week: log.week, date: log.date, pounds: change.to, reason: change.reason })
      }
    }
  }
  return { weights, changes, suggestions: [...latest.values()] }
}

/** Trained Strength sessions with sets, on or before `today`, oldest first; the latest edit stands for each. */
function strengthLogs(program: Program, logs: SessionLog[], today: LocalDate): { log: SessionLog; session: Session }[] {
  const standing = new Map<string, SessionLog>()
  for (const log of logs) {
    const key = `${log.week}/${log.sessionId}`
    const other = standing.get(key)
    if (!other || log.updatedAt > other.updatedAt) standing.set(key, log)
  }
  return [...standing.values()]
    .filter((log) => trained(log) && log.sets.length > 0 && daysBetween(log.date, today) >= 0)
    .sort((a, b) => (a.date === b.date ? a.updatedAt.localeCompare(b.updatedAt) : a.date.localeCompare(b.date)))
    .flatMap((log) => {
      const session = program.phases
        .flatMap((p) => p.weeks)
        .find((w) => w.number === log.week)
        ?.sessions.find((s) => s.id === log.sessionId)
      return session?.type === 'strength' ? [{ log, session }] : []
    })
}

function byLift(sets: SetLog[]): Map<LiftId, SetLog[]> {
  const lifts = new Map<LiftId, SetLog[]>()
  for (const set of sets) {
    if (set.lift === null || set.pounds === null) continue
    lifts.set(set.lift, [...(lifts.get(set.lift) ?? []), set])
  }
  return lifts
}

/**
 * The Program's sets for a lift in a Session, Substitutions included: the
 * lift a set was logged on says which Exercise it was, whatever the Equipment
 * profile is now.
 */
export function liftPrescription(session: Session, lift: LiftId): Sets | null {
  for (const block of session.blocks) {
    for (const exercise of block.exercises) {
      for (const candidate of [exercise, ...(exercise.substitutions ?? []).flatMap((s) => s.options)]) {
        const rx = candidate.prescription
        if (rx.kind === 'sets' && 'lift' in rx.load && rx.load.lift === lift) return rx
      }
    }
  }
  return null
}

/** The lowest rep count that meets a target: 6 for "6–10". */
export const targetReps = (reps: number | Range) => (typeof reps === 'number' ? reps : reps[0])

/**
 * Calibration: the heaviest set that felt RPE 7 or easier. If every set
 * overshot, 5% under the lightest, so the next session starts below it.
 */
export function calibrated(sets: SetLog[]): number {
  const loads = sets.map((s) => s.pounds ?? 0)
  const easy = sets.filter((s) => s.rpe <= CALIBRATION_RPE).map((s) => s.pounds ?? 0)
  if (easy.length > 0) return Math.max(...easy)
  return Math.max(STEP, roundToFive((Math.min(...loads) * (100 - REDUCE_PERCENT)) / 100))
}

/**
 * Up: every set logged at the Working weight or more, every target rep, all
 * at RPE 7 or easier, and the Session Done. Hold: a set at RPE 9 or more, a
 * missed rep, or a set lighter than the Working weight. Anything else (an
 * RPE 8, a Session cut short) leaves the weight alone and breaks a run of holds.
 */
export function judge(sets: SetLog[], rx: Sets, current: number, done: boolean): 'increase' | 'hold' | 'steady' {
  const reps = targetReps(rx.reps)
  if (sets.some((s) => s.rpe >= HOLD_RPE || s.reps < reps || (s.pounds ?? 0) < current)) return 'hold'
  return done && sets.every((s) => s.rpe <= EASY_RPE) ? 'increase' : 'steady'
}

/** +5 lb; calves +5%, to the nearest 5 lb and never less than 5 lb. */
export function increase(lift: LiftId, current: number): number {
  return CALVES.includes(lift) ? Math.max(STEP, roundToFive((current * CALF_PERCENT) / 100)) : STEP
}

/** −5%, to the nearest 5 lb: at least 5 lb lighter, never under 5 lb. */
export function reduced(current: number): number {
  return Math.max(STEP, Math.min(current - STEP, roundToFive((current * (100 - REDUCE_PERCENT)) / 100)))
}

/**
 * The load a set starts at: the Working weight, its Deload share, or a light
 * technique load. Null where there's no Working weight yet.
 */
export function prescribedPounds(rx: Sets, weights: WorkingWeights): number | null {
  if (!('lift' in rx.load)) return null
  const weight = weights[rx.load.lift]
  if (weight === undefined) return null
  switch (rx.load.kind) {
    case 'working-weight':
      return weight
    case 'percent-of-working-weight': {
      const [low, high] = rx.load.percent
      return Math.max(STEP, roundToFive((weight * (low + high)) / 200))
    }
    case 'light':
      return Math.max(STEP, roundToFive((weight * LIGHT_PERCENT) / 100))
    case 'find-working-weight':
      return null
  }
}
