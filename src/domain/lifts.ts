/**
 * A Live Strength session: every set of the Session prefilled with its load
 * and target reps, logged one tap at a time, with a rest timer after each.
 *
 * Pure like the Live run session: every step takes `now` from the caller,
 * and the rest timer is a timestamp, so a reload or a locked phone loses
 * nothing.
 */
import type { LocalDate } from './calendar'
import { isLive as isLiveRunOrCircuit, parseLiveRun, type LiveRun } from './live'
import { POUNDS, type SessionLog, type SetLog } from './log'
import { SESSION_TYPES } from './program/describe'
import type { Block, LiftId, Prescription, Range, Session } from './program/types'
import type { Suggestion, WorkingWeightSuggestion } from './suggestion'
import { CALIBRATION_RPE, prescribedPounds, targetReps, type WorkingWeights } from './weights'

type Sets = Extract<Prescription, { kind: 'sets' }>

/** The plus and minus step, and the smallest plate pair: every load is in pounds. */
export const LOAD_STEP = 5

/** Where a calibration starts: an empty bar, or a light dumbbell. */
const START_POUNDS: Record<LiftId, number> = {
  'back-squat': 45,
  'romanian-deadlift': 45,
  'bulgarian-split-squat': 15,
  'single-leg-calf-raise': 15,
  'seated-calf-raise': 25,
  'standing-calf-raise-machine': 45,
  'seated-calf-raise-machine': 45,
}

/** A calibration from the Starting point's estimate starts here, as a share of it. */
export const ESTIMATE_START_PERCENT = 70

/** Rest where the Program doesn't say: longer after the main lifts. */
const REST_MAIN = 90
const REST_OTHER = 60
/** RPE 7 is about three reps left in reserve: the default where the Program sets no target. */
const DEFAULT_RPE = 7
/** A calibration can keep ramping, up to this many sets. */
const MAX_SETS = 12

export interface LiveExercise {
  name: string
  note: string | null
  /** Null for bodyweight work. */
  lift: LiftId | null
  /** The sets the Program asks for. A calibration may log more. */
  sets: number
  /** The target reps of each set: the low end of a range, the least that counts. */
  reps: number
  /** "5", "6 / leg", "6–10 each" */
  repsWords: string
  /** Each set's RPE until the athlete says otherwise. */
  rpe: number
  /** "RPE 7", "RPE 7–8", "RPE ≤ 6", "ramp to RPE 7"; null where the Program sets none. */
  rpeWords: string | null
  restSeconds: number
  /** No Working weight yet: ramp the sets up until one feels like RPE 7. */
  calibrate: boolean
}

export interface LiveSet {
  /** Null for bodyweight work. */
  pounds: number | null
  reps: number
  rpe: number
  done: boolean
}

/** A Live Strength session in progress, as stored on the device. */
export interface LiveLifts {
  week: number
  sessionId: string
  type: 'strength'
  /** "Strength, squat 3 × 5" */
  heading: string
  date: LocalDate
  /** Taken from the Prescription and the Working weights at Start. */
  exercises: LiveExercise[]
  /** Each Exercise's sets, in order. */
  sets: LiveSet[][]
  startedAt: number
  /** The rest after the set just logged; null when nobody's resting. */
  rest: { exercise: number; set: number; startedAt: number; seconds: number } | null
  /** Finish was tapped: the finish sheet is open until Keep going. */
  ending: boolean
  /** Open Working weight Suggestions for lifts in this session, asked before set 1 until answered. */
  prompts: WorkingWeightSuggestion[]
}

export interface LiftsStart {
  week: number
  /** The Session as the gym does it: Substitutions already in. */
  session: Session
  date: LocalDate
  weights: WorkingWeights
  /** The Starting point's estimated Working weights, for lifts with none yet. */
  estimates?: WorkingWeights
  /** The Coach's Suggestions now: the open Working weight ones for this session's lifts are asked at the start. */
  suggestions?: Suggestion[]
}

export function startLifts(
  { week, session, date, weights, estimates = {}, suggestions = [] }: LiftsStart,
  now: number,
): LiveLifts {
  const lifts = session.blocks.flatMap((block) =>
    block.exercises.flatMap(({ name, note, prescription: rx }) =>
      rx.kind === 'sets'
        ? [{ exercise: liveExercise(name, note ?? null, rx, block, weights), pounds: startingPounds(rx, weights, estimates) }]
        : [],
    ),
  )
  const exercises = lifts.map((l) => l.exercise)
  return {
    week,
    sessionId: session.id,
    type: 'strength',
    heading: `${SESSION_TYPES[session.type].name}, ${session.headline}`,
    date,
    exercises,
    sets: lifts.map(({ exercise: e, pounds }) =>
      Array.from({ length: e.sets }, () => ({ pounds, reps: e.reps, rpe: e.rpe, done: false })),
    ),
    startedAt: now,
    rest: null,
    ending: false,
    prompts: suggestions.filter(
      (s): s is WorkingWeightSuggestion =>
        s.kind === 'working-weight' && s.decision === 'open' && movesWorkingWeight(session, s.lift, weights),
    ),
  }
}

/**
 * Whether the session lifts at a lift's Working weight itself: not a
 * calibration, a Deload share or a Taper's light sets, where the Working
 * weight doesn't decide the load.
 */
function movesWorkingWeight(session: Session, lift: LiftId, weights: WorkingWeights): boolean {
  return session.blocks.some((b) =>
    b.exercises.some(
      ({ prescription: rx }) =>
        rx.kind === 'sets' && rx.load.kind === 'working-weight' && rx.load.lift === lift && weights[lift] !== undefined,
    ),
  )
}

/**
 * Accept or Keep on a Working weight prompt: Accept moves every set of the
 * lift not logged yet to the new Working weight. Either way the prompt is answered.
 */
export function answerPrompt(lifts: LiveLifts, id: string, decision: 'accepted' | 'kept'): LiveLifts {
  const prompt = lifts.prompts.find((p) => p.id === id)
  if (!prompt) return lifts
  const prompts = lifts.prompts.filter((p) => p.id !== id)
  if (decision === 'kept') return { ...lifts, prompts }
  return {
    ...lifts,
    prompts,
    sets: lifts.sets.map((sets, x) => {
      const e = lifts.exercises[x]
      return e.lift === prompt.lift && !e.calibrate
        ? sets.map((s) => (s.done ? s : { ...s, pounds: prompt.to.pounds }))
        : sets
    }),
  }
}

function liveExercise(name: string, note: string | null, rx: Sets, block: Block, weights: WorkingWeights): LiveExercise {
  const lift = 'lift' in rx.load ? rx.load.lift : null
  const calibrate =
    rx.load.kind === 'find-working-weight' || (rx.load.kind === 'working-weight' && weights[rx.load.lift] === undefined)
  const rpe = calibrate ? CALIBRATION_RPE : (rx.rpeCap ?? rx.rpe?.[0] ?? DEFAULT_RPE)
  const reps = typeof rx.reps === 'number' ? `${rx.reps}` : range(rx.reps)
  return {
    name,
    note,
    lift,
    sets: rx.sets,
    reps: targetReps(rx.reps),
    repsWords: `${reps}${rx.perLeg ? ' / leg' : ''}${rx.load.kind === 'bodyweight' && typeof rx.reps !== 'number' ? ' each' : ''}`,
    rpe,
    rpeWords: calibrate
      ? `ramp to RPE ${CALIBRATION_RPE}`
      : rx.rpeCap
        ? `RPE ≤ ${rx.rpeCap}`
        : rx.rpe
          ? `RPE ${range(rx.rpe)}`
          : null,
    restSeconds: rx.restSeconds?.[1] ?? (block.main ? REST_MAIN : REST_OTHER),
    calibrate,
  }
}

/** The Working weight (or its Deload or light share), or a calibration's starting load. */
function startingPounds(rx: Sets, weights: WorkingWeights, estimates: WorkingWeights): number | null {
  if (!('lift' in rx.load)) return null
  return prescribedPounds(rx, weights) ?? calibrationStart(rx.load.lift, weights, estimates)
}

/**
 * Where a calibration ramps from: about 70% of the estimate, to the 5 lb
 * below so the ramp starts on the light side, while the lift has no real
 * Working weight; otherwise the empty bar or a light dumbbell.
 */
function calibrationStart(lift: LiftId, weights: WorkingWeights, estimates: WorkingWeights): number {
  const estimate = weights[lift] === undefined ? estimates[lift] : undefined
  if (estimate === undefined) return START_POUNDS[lift]
  const share = Math.floor((estimate * ESTIMATE_START_PERCENT) / 100 / LOAD_STEP) * LOAD_STEP
  return Math.max(START_POUNDS[lift], share)
}

const range = ([low, high]: Range) => (low === high ? `${low}` : `${low}–${high}`)

/** The first set not logged yet, in order: the one the screen leads with. */
export function currentSet(lifts: LiveLifts): { exercise: number; set: number } | null {
  for (let exercise = 0; exercise < lifts.sets.length; exercise++) {
    const set = lifts.sets[exercise].findIndex((s) => !s.done)
    if (set >= 0) return { exercise, set }
  }
  return null
}

/** A new load for a set, which the sets after it follow until they're logged. */
export function setLoad(lifts: LiveLifts, exercise: number, set: number, pounds: number): LiveLifts {
  const target = lifts.sets[exercise]?.[set]
  if (!target || target.done || target.pounds === null || !Number.isFinite(pounds)) return lifts
  const load = Math.min(POUNDS[1], Math.max(POUNDS[0], Math.round(pounds / LOAD_STEP) * LOAD_STEP))
  return updateSets(lifts, exercise, (sets) =>
    sets.map((s, i) => (i >= set && !s.done ? { ...s, pounds: load } : s)),
  )
}

/** Log set: the set is done as it stands, and the rest before the next one starts. */
export function logSet(lifts: LiveLifts, exercise: number, set: number, now: number): LiveLifts {
  const target = lifts.sets[exercise]?.[set]
  if (!target || target.done) return lifts
  const next = updateSets(lifts, exercise, (sets) => sets.map((s, i) => (i === set ? { ...s, done: true } : s)))
  const more = currentSet(next) !== null
  return {
    ...next,
    rest: more ? { exercise, set, startedAt: now, seconds: lifts.exercises[exercise].restSeconds } : null,
  }
}

/**
 * Undo a set logged by mistake: it's not done again, its load, reps and RPE
 * as they were, so it can be changed and logged again. Its rest stops.
 */
export function unlogSet(lifts: LiveLifts, exercise: number, set: number): LiveLifts {
  const target = lifts.sets[exercise]?.[set]
  if (!target?.done) return lifts
  const next = updateSets(lifts, exercise, (sets) => sets.map((s, i) => (i === set ? { ...s, done: false } : s)))
  const resting = lifts.rest?.exercise === exercise && lifts.rest.set === set
  return resting ? { ...next, rest: null } : next
}

/** How many RPEs a set offers, one tap each. */
const RPE_CHOICES = 6

/**
 * The RPEs a set offers: six, from two below its target (never below 1 or
 * past 10), slid to keep an RPE already logged outside them.
 */
export function rpeChoices(target: number, logged?: number): number[] {
  let start = Math.min(Math.max(1, target - 2), 10 - RPE_CHOICES + 1)
  if (logged !== undefined && logged >= 1 && logged <= 10) {
    start = Math.min(Math.max(start, logged - RPE_CHOICES + 1), logged)
  }
  return Array.from({ length: RPE_CHOICES }, (_, i) => start + i)
}

export function setRpe(lifts: LiveLifts, exercise: number, set: number, rpe: number): LiveLifts {
  if (!lifts.sets[exercise]?.[set] || !Number.isInteger(rpe) || rpe < 1 || rpe > 10) return lifts
  return updateSets(lifts, exercise, (sets) => sets.map((s, i) => (i === set ? { ...s, rpe } : s)))
}

/** Reps actually done, when it wasn't the target. */
export function setReps(lifts: LiveLifts, exercise: number, set: number, reps: number): LiveLifts {
  if (!lifts.sets[exercise]?.[set] || !Number.isInteger(reps) || reps < 0 || reps > 100) return lifts
  return updateSets(lifts, exercise, (sets) => sets.map((s, i) => (i === set ? { ...s, reps } : s)))
}

/** Another ramp set for a calibration, at the last set's load. */
export function addSet(lifts: LiveLifts, exercise: number): LiveLifts {
  const sets = lifts.sets[exercise]
  const info = lifts.exercises[exercise]
  if (!sets || !info.calibrate || sets.length >= MAX_SETS) return lifts
  const last = sets[sets.length - 1]
  return updateSets(lifts, exercise, (s) => [...s, { pounds: last.pounds, reps: info.reps, rpe: info.rpe, done: false }])
}

function updateSets(lifts: LiveLifts, exercise: number, change: (sets: LiveSet[]) => LiveSet[]): LiveLifts {
  return { ...lifts, sets: lifts.sets.map((sets, i) => (i === exercise ? change(sets) : sets)) }
}

/** Seconds of rest left, or null when nobody's resting. */
export function restLeft(lifts: LiveLifts, now: number): number | null {
  if (!lifts.rest) return null
  return Math.max(0, lifts.rest.seconds - (now - lifts.rest.startedAt) / 1000)
}

/** Rest over, or cut short. */
export const endRest = (lifts: LiveLifts): LiveLifts => (lifts.rest ? { ...lifts, rest: null } : lifts)

/** Finish session: the finish sheet. Keep going is `keepGoing`. */
export const finish = (lifts: LiveLifts): LiveLifts => ({ ...lifts, ending: true, rest: null })
export const keepGoing = (lifts: LiveLifts): LiveLifts => ({ ...lifts, ending: false })

/**
 * The Overall RPE the finish sheet starts on: the hardest set logged, since a
 * Session feels like its worst set. Null with nothing logged, so nothing is guessed.
 */
export function predictedLiftsRpe(lifts: LiveLifts): number | null {
  const done = lifts.sets.flat().filter((s) => s.done)
  return done.length === 0 ? null : Math.max(...done.map((s) => s.rpe))
}

/** Done when every set the Program asks for is logged; Partial otherwise. */
export function liftsStatus(lifts: LiveLifts): 'done' | 'partial' {
  return lifts.exercises.every((e, i) => lifts.sets[i].filter((s) => s.done).length >= e.sets) ? 'done' : 'partial'
}

export interface LiftsLogInput {
  id: string
  rpe: number | null
  updatedAt: string
}

/** The Session log a finished Live Strength session saves: every logged set. */
export function liftsLog(lifts: LiveLifts, now: number, input: LiftsLogInput): SessionLog {
  const sets: SetLog[] = lifts.sets.flatMap((sets, exercise) =>
    sets
      .map((s, i) => ({ s, set: i + 1 }))
      .filter(({ s }) => s.done)
      .map(({ s, set }) => ({
        exercise,
        set,
        lift: lifts.exercises[exercise].lift,
        pounds: s.pounds,
        reps: s.reps,
        rpe: s.rpe,
      })),
  )
  return {
    id: input.id,
    week: lifts.week,
    sessionId: lifts.sessionId,
    date: lifts.date,
    status: liftsStatus(lifts),
    minutes: Math.min(600, Math.max(1, Math.round((now - lifts.startedAt) / 60_000))),
    rpe: input.rpe,
    notes: null,
    resultSeconds: null,
    environment: null,
    distanceMeters: null,
    recoveryPace: null,
    intervals: [],
    stations: [],
    sets,
    updatedAt: input.updatedAt,
  }
}

/** A stored Live Strength session, checked enough to trust: anything else is dropped. */
export function parseLiveLifts(value: unknown): LiveLifts | null {
  if (typeof value !== 'object' || value === null) return null
  const v = value as Partial<LiveLifts>
  if (v.type !== 'strength') return null
  if (![v.week, v.startedAt].every((n) => typeof n === 'number' && Number.isFinite(n))) return null
  if (typeof v.sessionId !== 'string' || typeof v.heading !== 'string' || typeof v.date !== 'string') return null
  if (!Array.isArray(v.exercises) || !Array.isArray(v.sets) || v.exercises.length !== v.sets.length) return null
  if (!v.sets.every(Array.isArray)) return null
  if (v.rest !== null && (typeof v.rest !== 'object' || typeof v.rest?.startedAt !== 'number')) return null
  return { ...v, ending: v.ending === true, prompts: Array.isArray(v.prompts) ? v.prompts : [] } as LiveLifts
}

/** Whatever is running on the device: a run or a HYROX circuit against the clock, or sets at the rack. */
export type LiveSession = LiveRun | LiveLifts

export const isLifts = (live: LiveSession): live is LiveLifts => live.type === 'strength'

/** What Start session runs: not a Session the pain rules turned into easy bike, with nothing left to lift or run. */
export const isLive = (session: Session) =>
  (session.type === 'strength' && session.blocks.some((b) => b.exercises.some((e) => e.prescription.kind === 'sets'))) ||
  isLiveRunOrCircuit(session)

export function parseLiveSession(value: unknown): LiveSession | null {
  return parseLiveLifts(value) ?? parseLiveRun(value)
}
