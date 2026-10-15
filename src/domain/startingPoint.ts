/**
 * The Starting point (CONTEXT.md): estimates the athlete gives once, at
 * first launch, so the first weeks aren't RPE-only runs and calibrations
 * from an empty bar. An estimated 5K time stands in for a 5K test until the
 * first real one; an estimated Working weight starts a lift's calibration
 * higher (src/domain/lifts.ts). A real result always wins over an estimate.
 *
 * One record, synced like Pain reports: the later edit wins. Skipping is a
 * record too, with nothing in it, so the screen shows once.
 */
import type { SessionLog } from './log'
import { FIVE_K_SECONDS } from './paces'
import type { LiftId, Range } from './program/types'
import type { WorkingWeights } from './weights'

/** The main lifts the Program calibrates in Week 1. */
export const ESTIMATED_LIFTS = ['back-squat', 'romanian-deadlift'] as const satisfies readonly LiftId[]
export type EstimatedLift = (typeof ESTIMATED_LIFTS)[number]

export const ESTIMATED_LIFT_LABEL: Record<EstimatedLift, string> = {
  'back-squat': 'Back squat',
  'romanian-deadlift': 'Romanian deadlift',
}

/** An estimated Working weight from 5 lb to 1000 lb is believable. */
export const ESTIMATE_POUNDS: Range = [5, 1000]

export interface StartingPoint {
  /** The estimated 5K time in seconds, or null when skipped. */
  fiveKSeconds: number | null
  /** Estimated Working weights in pounds; a lift left out was skipped. */
  weights: Partial<Record<EstimatedLift, number>>
  /** ISO instant of the last edit: the later one wins on sync. */
  updatedAt: string
}

/** A Starting point with nothing given: both sections skipped. */
export const SKIPPED: Omit<StartingPoint, 'updatedAt'> = { fiveKSeconds: null, weights: {} }

/** A stored or sent Starting point, checked. Throws on anything else. */
export function parseStartingPoint(value: unknown): StartingPoint {
  if (typeof value !== 'object' || value === null) throw new Error('A Starting point must be an object')
  const v = value as Record<string, unknown>
  const fiveK = v.fiveKSeconds ?? null
  if (fiveK !== null && !(Number.isInteger(fiveK) && within(fiveK as number, FIVE_K_SECONDS))) {
    throw new Error(`fiveKSeconds: a 5K time from ${FIVE_K_SECONDS[0]} to ${FIVE_K_SECONDS[1]} seconds`)
  }
  const raw = (typeof v.weights === 'object' && v.weights !== null ? v.weights : {}) as Record<string, unknown>
  const weights: StartingPoint['weights'] = {}
  for (const [lift, pounds] of Object.entries(raw)) {
    if (pounds === null || pounds === undefined) continue
    if (!ESTIMATED_LIFTS.includes(lift as EstimatedLift)) throw new Error(`weights.${lift}: not a lift to estimate`)
    if (!Number.isInteger(pounds) || !within(pounds as number, ESTIMATE_POUNDS)) {
      throw new Error(`weights.${lift}: whole pounds from ${ESTIMATE_POUNDS[0]} to ${ESTIMATE_POUNDS[1]}`)
    }
    weights[lift as EstimatedLift] = pounds as number
  }
  if (typeof v.updatedAt !== 'string' || v.updatedAt === '') throw new Error('updatedAt: an ISO instant')
  return { fiveKSeconds: fiveK as number | null, weights, updatedAt: v.updatedAt }
}

const within = (n: number, [low, high]: Range) => n >= low && n <= high

/** The later edit of two, or whichever there is. */
export function laterStartingPoint(ours: StartingPoint | null, theirs: StartingPoint | null): StartingPoint | null {
  if (!ours || !theirs) return ours ?? theirs
  return theirs.updatedAt > ours.updatedAt ? theirs : ours
}

/** The estimates that still start a calibration: each lift's, until it has a real Working weight. */
export function startingWeights(point: StartingPoint | null, weights: WorkingWeights): WorkingWeights {
  return Object.fromEntries(
    Object.entries(point?.weights ?? {}).filter(([lift]) => weights[lift as LiftId] === undefined),
  ) as WorkingWeights
}

/** A Starting point field as Settings shows it: the estimate, or the real result that replaced it. */
export interface StartingField {
  value: number | null
  /** A real result: the field is read-only. */
  real: boolean
}

export function startingFields(
  point: StartingPoint | null,
  fiveKTest: SessionLog | null,
  weights: WorkingWeights,
): { fiveK: StartingField; lifts: Record<EstimatedLift, StartingField> } {
  const lift = (id: EstimatedLift): StartingField => {
    const real = weights[id]
    return real !== undefined ? { value: real, real: true } : { value: point?.weights[id] ?? null, real: false }
  }
  return {
    fiveK:
      fiveKTest?.resultSeconds != null
        ? { value: fiveKTest.resultSeconds, real: true }
        : { value: point?.fiveKSeconds ?? null, real: false },
    lifts: Object.fromEntries(ESTIMATED_LIFTS.map((id) => [id, lift(id)])) as Record<EstimatedLift, StartingField>,
  }
}
