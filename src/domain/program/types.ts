import type { LocalDate } from '../calendar'

/**
 * The Program as data: Phase → Week → Session → Block → Exercise.
 *
 * Prescriptions are relative. A run points at a Training pace (or RPE), a lift
 * at its Working weight, a Station at a percentage of its Race load. The Coach
 * turns them into absolute speeds and pounds once there is a 5K test and a
 * calibrated Working weight to resolve them against.
 */
export interface Program {
  version: number
  /** Race day; every Week is counted back from it. */
  raceDay: LocalDate
  /** Week 1 is the Monday `weekCount - 1` Weeks before Race week's Monday. */
  weekCount: number
  stations: Record<StationId, Station>
  phases: Phase[]
}

export type PhaseId = 'foundation' | '5k-development' | 'hyrox-build' | 'race-specific' | 'taper'

export interface Phase {
  id: PhaseId
  name: string
  firstWeek: number
  lastWeek: number
  /** The Weeks encoded so far, in order. */
  weeks: Week[]
}

export interface Week {
  number: number
  /** Always a Monday. */
  startDate: LocalDate
  deload: boolean
  fiveKTest: boolean
  raceSimulation: boolean
  /** Race week: the Week holding Race day. */
  race: boolean
  /** Things the Week asks for that aren't Sessions: rest days, kit, recovery. */
  notes?: string[]
  /** The Bucket, in display order: Speed, Strength, Threshold, HYROX, then the Optional session. */
  sessions: Session[]
}

export type SessionType =
  | 'speed'
  | 'strength'
  | 'threshold'
  | 'hyrox'
  | 'easy'
  | '5k-test'
  | 'race-simulation'

/** The five lane colours. A 5K test runs in the Speed lane, a Race simulation in the HYROX lane. */
export type Lane = 'speed' | 'strength' | 'threshold' | 'hyrox' | 'easy'

export interface Session {
  /** Unique within its Week. */
  id: string
  type: SessionType
  /** What follows the Session type in a heading: "5 × 2′" in "Speed, 5 × 2′". */
  headline: string
  minutes: number
  key: boolean
  optional: boolean
  /** Pinned to one day, unlike the rest of the Bucket. Only Race day so far. */
  date?: LocalDate
  /** Instruction for the whole Session: "Not all-out", "Only if fresh". */
  note?: string
  blocks: Block[]
}

export interface Block {
  name: string
  /** Absent where the Program doesn't time the Block (lifting, a 5 km test). */
  minutes?: number
  /** The Block that carries the Session's point (the intervals, the main lifts, the 5 km). */
  main?: boolean
  /**
   * HYROX's Set up: every Station the Session uses, at its load, set up once
   * before round 1. Untimed, and never in the Session's minutes or its Training load.
   */
  setup?: boolean
  exercises: Exercise[]
}

export interface Exercise {
  name: string
  prescription: Prescription
  note?: string
  substitutions?: Substitution[]
}

/** Why a Substitution applies: a piece of the Equipment profile missing, or Readiness. */
export type SubstitutionReason = 'no-floor-space' | 'no-calf-machine' | 'no-seated-calf-machine' | 'readiness'

export interface Substitution {
  when: SubstitutionReason[]
  options: Exercise[]
}

export type Prescription =
  /** Continuous running for a time or a distance. */
  | { kind: 'run'; minutes?: number; meters?: number; effort?: RunEffort }
  | {
      kind: 'intervals'
      reps: number
      workSeconds: number
      recoverySeconds: number
      recovery: 'jog' | 'walk'
      effort: RunEffort
    }
  | { kind: 'strides'; reps: number; seconds: number }
  | { kind: 'accelerations'; reps: number; meters: number; percentOfMax: Range }
  | {
      kind: 'sets'
      sets: number
      reps: number | Range
      perLeg?: boolean
      load: StrengthLoad
      rpe?: Range
      restSeconds?: Range
      /** A ceiling rather than a target: Deload sets stay at or under it. */
      rpeCap?: number
    }
  /** `raceLoadPercent` only where the Station carries a load that scales (not SkiErg, row, burpees or wall balls). */
  | { kind: 'station'; station: StationId; meters?: number; reps?: number; raceLoadPercent?: number }
  /** A warm-up drill, counted rather than timed: "A-skips 2 × 20 m", "Leg swings 10 / leg". */
  | { kind: 'drill'; sets: number; reps?: number; meters?: number; perLeg?: boolean }
  /** Sprints on a bike or a sled, as many as the Exercise they replace. */
  | { kind: 'sprints'; seconds?: Range; meters?: Range; light?: boolean }
  /** Anything done by instruction rather than by number: drills, movement prep, a walk. */
  | { kind: 'note'; minutes?: number }

export type Range = readonly [low: number, high: number]

export type PaceRef = 'easy' | 'threshold' | '5k' | 'goal'

export type RunEffort =
  /** At a Training pace. Until the first 5K test sets the paces, `rpe` is the whole target. */
  | {
      pace: PaceRef
      rpe?: Range
      /** Faster than the pace by this much: "5K −5 s/km". */
      secondsPerKmFaster?: number
    }
  /** By feel, with no pace to resolve. */
  | { feel: 'easy' | 'hard' | 'controlled' | 'relaxed' | 'all-out'; rpe?: Range }

export const LIFTS = [
  'back-squat',
  'romanian-deadlift',
  'bulgarian-split-squat',
  'single-leg-calf-raise',
  'seated-calf-raise',
  'standing-calf-raise-machine',
  'seated-calf-raise-machine',
] as const

/** A lift with a Working weight of its own. A Substitution's lift has its own, since its loads differ. */
export type LiftId = (typeof LIFTS)[number]

export type StrengthLoad =
  | { kind: 'working-weight'; lift: LiftId }
  /** A share of the Working weight: Deload sets at 85–90%. */
  | { kind: 'percent-of-working-weight'; lift: LiftId; percent: Range }
  /** Technique weight, well under the Working weight: the Taper. */
  | { kind: 'light'; lift: LiftId }
  /** Calibration: ramp up until a set feels like `rpe`; that load becomes the Working weight. */
  | { kind: 'find-working-weight'; lift: LiftId; rpe: number }
  | { kind: 'bodyweight' }

export type StationId =
  | 'skierg'
  | 'sled-push'
  | 'sled-pull'
  | 'burpee-broad-jumps'
  | 'row'
  | 'farmers-carry'
  | 'sandbag-lunges'
  | 'wall-balls'

export interface Station {
  id: StationId
  name: string
  /** Position in race order, 1–8. */
  order: number
  raceLoad: {
    meters?: number
    reps?: number
    /** Pounds per implement. Sled loads are plate weight: the sled counts as zero. */
    pounds?: number
    implements?: number
    /** Volume scales in training; the load never does (wall balls). */
    fixedLoad?: boolean
  }
}
