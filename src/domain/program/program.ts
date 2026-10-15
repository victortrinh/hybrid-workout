/**
 * The approved Program (docs/training-plan.md, approved 13 Oct 2026) as data.
 *
 * All 27 Weeks, built from the Session templates in the plan. Where the plan
 * leaves a detail open (which Stations go in which round, the Deload volumes
 * of accessory lifts) the choice is made once here and commented.
 */
import { localDate } from '../calendar'
import type {
  Block,
  Exercise,
  LiftId,
  Prescription,
  Program,
  Range,
  RunEffort,
  Session,
  Station,
  StationId,
  StrengthLoad,
  Substitution,
  Week,
} from './types'

// ---------------------------------------------------------------------------
// Race loads: Men's Open 2025/26, in pounds. Verify on hyrox.com before race day.

export const stations: Record<StationId, Station> = {
  skierg: { id: 'skierg', name: 'SkiErg', order: 1, raceLoad: { meters: 1000 } },
  'sled-push': { id: 'sled-push', name: 'Sled push', order: 2, raceLoad: { meters: 50, pounds: 335 } },
  'sled-pull': { id: 'sled-pull', name: 'Sled pull', order: 3, raceLoad: { meters: 50, pounds: 227 } },
  'burpee-broad-jumps': {
    id: 'burpee-broad-jumps',
    name: 'Burpee broad jumps',
    order: 4,
    raceLoad: { meters: 80 },
  },
  row: { id: 'row', name: 'Row', order: 5, raceLoad: { meters: 1000 } },
  'farmers-carry': {
    id: 'farmers-carry',
    name: 'Farmers carry',
    order: 6,
    raceLoad: { meters: 200, pounds: 53, implements: 2 },
  },
  'sandbag-lunges': {
    id: 'sandbag-lunges',
    name: 'Sandbag lunges',
    order: 7,
    raceLoad: { meters: 100, pounds: 44 },
  },
  'wall-balls': {
    id: 'wall-balls',
    name: 'Wall balls',
    order: 8,
    raceLoad: { reps: 100, pounds: 13, fixedLoad: true },
  },
}

/** Stations in race order. */
const RACE_ORDER = (Object.values(stations) as Station[]).sort((a, b) => a.order - b.order).map((s) => s.id)

// ---------------------------------------------------------------------------
// Building blocks shared by the Session templates.

const EASY_RPE = [2, 4] as const
const THRESHOLD_RPE = [6, 7] as const

const easyJog = (minutes: number, name = 'Easy jog'): Exercise => ({
  name,
  prescription: { kind: 'run', minutes, effort: { pace: 'easy', rpe: EASY_RPE } },
})

const walk = (minutes: number | undefined, name: string, note?: string): Exercise => ({
  name,
  prescription: { kind: 'note', minutes },
  note,
})

const drill = (name: string, sets: number, amount: { reps?: number; meters?: number; perLeg?: boolean }): Exercise => ({
  name,
  prescription: { kind: 'drill', sets, ...amount },
})

/** Speed's warm-up: a jog, then the drills ticked off one by one. Same 10 minutes as ever. */
const speedWarmUp: Block[] = [
  { name: 'Warm-up', minutes: 7, exercises: [easyJog(7)] },
  {
    name: 'Drills',
    minutes: 3,
    exercises: [
      drill('Leg swings', 1, { reps: 10, perLeg: true }),
      drill('A-skips', 2, { meters: 20 }),
      drill('B-skips', 2, { meters: 20 }),
      drill('High knees', 1, { meters: 20 }),
      drill('Butt kicks', 1, { meters: 20 }),
    ],
  },
]

/** No floor space, or Readiness says no jumps: sprint on the sled or the bike instead. */
const floorSubstitution: Substitution = {
  when: ['no-floor-space', 'readiness'],
  options: [
    { name: 'Sled push sprints', prescription: { kind: 'sprints', meters: [10, 15], light: true } },
    { name: 'Bike sprints', prescription: { kind: 'sprints', seconds: [8, 10] } },
  ],
}

const pogo = (sets: number, reps: number): Exercise => ({
  name: 'Pogo jumps',
  prescription: { kind: 'sets', sets, reps, load: { kind: 'bodyweight' } },
  note: 'Ground contacts',
  substitutions: [floorSubstitution],
})

const broadJumps = (sets: number, reps: number): Exercise => ({
  name: 'Broad jumps',
  prescription: { kind: 'sets', sets, reps, load: { kind: 'bodyweight' } },
  note: 'Full reset between jumps',
  substitutions: [floorSubstitution],
})

/** Accelerations start at 80–90% and build to 90–95% from the 5K development Phase on. */
const accelerations = (reps: number, percentOfMax: Range, note: string): Exercise => ({
  name: 'Accelerations',
  prescription: { kind: 'accelerations', reps, meters: 15, percentOfMax },
  note,
  substitutions: [floorSubstitution],
})

/** 120 → "2′", 90 → "90″" */
const minutesMark = (seconds: number) => (seconds % 60 === 0 ? `${seconds / 60}′` : `${seconds}″`)

interface Intervals {
  reps: number
  workSeconds: number
  recoverySeconds: number
  effort: RunEffort
}

const HARD: RunEffort = { feel: 'hard' }
const AT_5K: RunEffort = { pace: '5k' }

function speed(intervals: Intervals, accels: number, week: number, key = false): Session {
  const early = week <= 6
  return {
    id: 'speed',
    type: 'speed',
    headline: `${intervals.reps} × ${minutesMark(intervals.workSeconds)}`,
    minutes: 45,
    key,
    optional: false,
    note: 'Finish fresh enough for the next Hard session.',
    blocks: [
      ...speedWarmUp,
      { name: 'Plyometrics', minutes: 5, exercises: [pogo(2, 15), broadJumps(3, 3)] },
      {
        name: 'Accelerations',
        minutes: 5,
        exercises: [
          early
            ? accelerations(accels, [80, 90], 'Walk back. Never maximal this early.')
            : accelerations(accels, [90, 95], 'Walk back. Fast, not maximal.'),
        ],
      },
      {
        name: 'Intervals',
        minutes: 20,
        main: true,
        exercises: [{ name: 'Intervals', prescription: { kind: 'intervals', ...intervals, recovery: 'jog' } }],
      },
      { name: 'Cooldown', minutes: 5, exercises: [easyJog(5, 'Jog or walk')] },
    ],
  }
}

/** Deload Speed: 4 × 2′ controlled, half the jump contacts, two easy accelerations. */
const speedDeload: Session = {
  id: 'speed',
  type: 'speed',
  headline: '4 × 2′ controlled',
  minutes: 35,
  key: false,
  optional: false,
  blocks: [
    ...speedWarmUp,
    { name: 'Plyometrics', minutes: 3, exercises: [pogo(1, 15), broadJumps(2, 2)] },
    {
      name: 'Accelerations',
      minutes: 3,
      exercises: [accelerations(2, [80, 85], 'Walk back. Easy speed.')],
    },
    {
      name: 'Intervals',
      minutes: 14,
      main: true,
      exercises: [
        {
          name: 'Intervals',
          prescription: {
            kind: 'intervals',
            reps: 4,
            workSeconds: 120,
            recoverySeconds: 120,
            recovery: 'jog',
            effort: { feel: 'controlled' },
          },
        },
      ],
    },
    { name: 'Cooldown', minutes: 5, exercises: [easyJog(5, 'Jog or walk')] },
  ],
}

/** Taper Speed: short and sharp, no maximal sprinting, no broad jumps. */
const speedTaper: Session = {
  id: 'speed',
  type: 'speed',
  headline: '4 × 2′',
  minutes: 40,
  key: true,
  optional: false,
  note: 'Last speed before the race. No max sprinting, no broad jumps.',
  blocks: [
    ...speedWarmUp,
    { name: 'Plyometrics', minutes: 2, exercises: [pogo(1, 10)] },
    {
      name: 'Intervals',
      minutes: 14,
      main: true,
      exercises: [
        {
          name: 'Intervals',
          prescription: { kind: 'intervals', reps: 4, workSeconds: 120, recoverySeconds: 120, recovery: 'jog', effort: AT_5K },
        },
      ],
    },
    { name: 'Cooldown', minutes: 10, exercises: [easyJog(10, 'Jog or walk')] },
  ],
}

const FIVE_K_TEST_NAMES = { 2: 'baseline', 9: 'second', 17: 'third', 25: 'final' } as const

function fiveKTest(week: keyof typeof FIVE_K_TEST_NAMES): Session {
  return {
    id: '5k-test',
    type: '5k-test',
    headline: FIVE_K_TEST_NAMES[week],
    minutes: 45,
    key: true,
    optional: false,
    blocks: [
      { name: 'Warm-up', minutes: 10, exercises: [easyJog(10)] },
      { name: 'Strides', minutes: 2, exercises: [{ name: 'Strides', prescription: { kind: 'strides', reps: 4, seconds: 15 } }] },
      {
        name: '5 km',
        main: true,
        exercises: [
          {
            name: '5 km time trial',
            prescription: { kind: 'run', meters: 5000, effort: { feel: 'all-out' } },
            note: 'Indoors: treadmill at 1% incline. The time resets the Training paces.',
          },
        ],
      },
      { name: 'Cooldown', minutes: 8, exercises: [easyJog(8)] },
    ],
  }
}

function threshold(reps: number, repMinutes: number, recoverySeconds: number, key: boolean): Session {
  const work = reps * repMinutes + ((reps - 1) * recoverySeconds) / 60
  return {
    id: 'threshold',
    type: 'threshold',
    headline: `${reps} × ${repMinutes}′`,
    minutes: 45,
    key,
    optional: false,
    blocks: [
      { name: 'Warm-up', minutes: 10, exercises: [easyJog(10)] },
      {
        name: 'Threshold',
        minutes: work,
        main: true,
        exercises: [
          {
            name: 'Threshold reps',
            prescription: {
              kind: 'intervals',
              reps,
              workSeconds: repMinutes * 60,
              recoverySeconds,
              recovery: 'jog',
              effort: { pace: 'threshold', rpe: THRESHOLD_RPE },
            },
            note: 'Never racing.',
          },
        ],
      },
      { name: 'Easy and cooldown', minutes: 45 - 10 - work, exercises: [easyJog(45 - 10 - work)] },
    ],
  }
}

/** A Bucket's Easy run, Optional or (in Deload and Taper Weeks) in Threshold's place. */
function easyRun(
  minutes: number,
  { id = 'easy', optional = true, note = 'Full sentences. No tempo, no hills.', extra = [] as Exercise[] } = {},
): Session {
  return {
    id,
    type: 'easy',
    headline: `${minutes}′`,
    minutes,
    key: false,
    optional,
    blocks: [
      {
        name: 'Easy run',
        minutes,
        main: true,
        exercises: [{ ...easyJog(minutes, 'Easy run'), note }, ...extra],
      },
    ],
  }
}

/** Deload Weeks replace Threshold with 35–40 minutes of easy running. */
const easyInsteadOfThreshold = easyRun(40, {
  id: 'easy-deload',
  optional: false,
  note: 'Deload: easy running in place of Threshold. Full sentences.',
})

type StrengthPhase = 'build' | 'maintenance'
type Sets = Extract<Prescription, { kind: 'sets' }>

/** The same sets on the other lift: a machine's loads aren't a dumbbell's, so each has its own Working weight. */
function onLift(rx: Sets, lift: LiftId): Sets {
  return 'lift' in rx.load ? { ...rx, load: { ...rx.load, lift } } : rx
}

/**
 * Calf raises as the Program writes them, on the machines. The athlete's gym
 * has none (training-plan.md, "Resolved during approval"), so the Equipment
 * profile swaps in the dumbbell single-leg raise and the loaded seated raise.
 * `rx` is written for the dumbbell lift.
 */
function standingCalfRaise(rx: Sets): Exercise {
  return {
    name: 'Standing calf raise',
    prescription: onLift(rx, 'standing-calf-raise-machine'),
    note: 'Machine, one leg at a time, 2–3 s lowering',
    substitutions: [
      {
        when: ['no-calf-machine'],
        options: [{ name: 'Single-leg calf raise', prescription: rx, note: 'Off a step, dumbbell in hand, 2–3 s lowering' }],
      },
    ],
  }
}

function seatedCalfRaise(rx: Sets): Exercise {
  return {
    name: 'Seated calf raise',
    prescription: onLift(rx, 'seated-calf-raise-machine'),
    note: 'Machine',
    substitutions: [
      {
        when: ['no-seated-calf-machine'],
        options: [{ name: 'Loaded seated calf raise', prescription: rx, note: 'Dumbbell or barbell on the knees' }],
      },
    ],
  }
}

function strength(phase: StrengthPhase, { calibration = false, deload = false } = {}): Session {
  const load = (lift: LiftId): StrengthLoad =>
    calibration
      ? { kind: 'find-working-weight', lift, rpe: 7 }
      : deload
        ? { kind: 'percent-of-working-weight', lift, percent: [85, 90] }
        : { kind: 'working-weight', lift }
  const build = phase === 'build'
  const mainRpe: Range | undefined = calibration || deload ? undefined : build ? [7, 7] : [7, 8]
  const rpe7: Range | undefined = calibration || deload ? undefined : [7, 7]
  const rpeCap = deload ? 6 : undefined
  const squat = build ? { sets: 3, reps: 5 } : { sets: 2, reps: 4 }
  const rdl = build ? { sets: 3, reps: 6 } : { sets: 2, reps: 4 }
  // Deload: the main lifts drop to 2 sets; accessories lose about a third of their sets.
  const sets = (normal: number) => (deload ? Math.max(1, Math.round((normal * 2) / 3)) : normal)

  return {
    id: 'strength',
    type: 'strength',
    headline: calibration
      ? 'find Working weights'
      : deload
        ? 'deload'
        : `squat ${squat.sets} × ${squat.reps}`,
    minutes: deload ? 30 : 45,
    key: false,
    optional: false,
    blocks: [
      {
        name: 'Warm-up',
        minutes: 6,
        exercises: [{ name: 'Bike, movement prep and ramp-up sets', prescription: { kind: 'note', minutes: 6 } }],
      },
      {
        name: 'Strength',
        main: true,
        exercises: [
          {
            name: 'Back squat',
            prescription: {
              kind: 'sets',
              sets: deload ? 2 : squat.sets,
              reps: squat.reps,
              load: load('back-squat'),
              rpe: mainRpe,
              rpeCap,
              restSeconds: [90, 120],
            },
          },
          {
            name: 'Romanian deadlift',
            prescription: { kind: 'sets', sets: deload ? 2 : rdl.sets, reps: rdl.reps, load: load('romanian-deadlift'), rpe: mainRpe, rpeCap },
            note: 'Slow lowering',
          },
        ],
      },
      {
        name: 'Unilateral',
        exercises: [
          {
            name: 'Bulgarian split squat',
            prescription: { kind: 'sets', sets: sets(2), reps: 6, perLeg: true, load: load('bulgarian-split-squat'), rpe: rpe7, rpeCap },
          },
        ],
      },
      {
        name: 'Tendon',
        exercises: [
          standingCalfRaise({ kind: 'sets', sets: sets(3), reps: 8, perLeg: true, load: load('single-leg-calf-raise') }),
          seatedCalfRaise({ kind: 'sets', sets: sets(2), reps: 10, load: load('seated-calf-raise') }),
        ],
      },
      {
        name: 'Upper',
        exercises: [
          {
            name: 'Pull-ups and push-ups',
            prescription: { kind: 'sets', sets: sets(2), reps: [6, 10], load: { kind: 'bodyweight' } },
            note: 'Superset, each',
          },
        ],
      },
    ],
  }
}

/** Taper Strength: light technique only. */
const strengthTaper: Session = {
  id: 'strength',
  type: 'strength',
  headline: 'light technique',
  minutes: 30,
  key: false,
  optional: false,
  note: 'No heavy lowering.',
  blocks: [
    {
      name: 'Warm-up',
      minutes: 6,
      exercises: [{ name: 'Bike and movement prep', prescription: { kind: 'note', minutes: 6 } }],
    },
    {
      name: 'Strength',
      main: true,
      exercises: [
        { name: 'Back squat', prescription: { kind: 'sets', sets: 2, reps: 3, load: { kind: 'light', lift: 'back-squat' } } },
        {
          name: 'Romanian deadlift',
          prescription: { kind: 'sets', sets: 2, reps: 3, load: { kind: 'light', lift: 'romanian-deadlift' } },
        },
      ],
    },
    {
      name: 'Tendon',
      exercises: [
        standingCalfRaise({ kind: 'sets', sets: 2, reps: 8, perLeg: true, load: { kind: 'light', lift: 'single-leg-calf-raise' } }),
      ],
    },
  ],
}

// ---------------------------------------------------------------------------
// HYROX: three rounds of a run and Stations, by Phase and Rotation.

type Rotation = 'A' | 'B'
type Volume = { meters?: number; reps?: number }

/** One Station at a share of Race load. Only Stations whose load scales carry the percentage. */
function station(id: StationId, volume: Volume, percent: number): Exercise {
  const scales = stations[id].raceLoad.pounds !== undefined && !stations[id].raceLoad.fixedLoad
  return {
    name: stations[id].name,
    prescription: { kind: 'station', station: id, ...volume, raceLoadPercent: scales ? percent : undefined },
  }
}

/** Station volume per round, by Phase (training-plan.md, HYROX table). */
const VOLUME: Record<'foundation' | 'development' | 'build', Record<StationId, Volume>> = {
  foundation: {
    'sled-push': { meters: 25 },
    'sled-pull': { meters: 25 },
    'farmers-carry': { meters: 50 },
    'sandbag-lunges': { meters: 25 },
    skierg: { meters: 250 },
    row: { meters: 250 },
    'burpee-broad-jumps': { meters: 10 },
    'wall-balls': { reps: 20 },
  },
  development: {
    'sled-push': { meters: 25 },
    'sled-pull': { meters: 25 },
    'farmers-carry': { meters: 100 },
    'sandbag-lunges': { meters: 50 },
    skierg: { meters: 300 },
    row: { meters: 300 },
    'burpee-broad-jumps': { meters: 20 },
    'wall-balls': { reps: 30 },
  },
  build: {
    'sled-push': { meters: 50 },
    'sled-pull': { meters: 50 },
    'farmers-carry': { meters: 100 },
    'sandbag-lunges': { meters: 50 },
    skierg: { meters: 500 },
    row: { meters: 500 },
    'burpee-broad-jumps': { meters: 40 },
    'wall-balls': { reps: 50 },
  },
}

/**
 * Which Stations go in each of the three rounds. The plan gives the count per
 * round by Phase (2, then 2–3, then 1–2); the pairing is chosen here so every
 * Station of the Rotation appears each Session.
 */
const ROUNDS: Record<'foundation' | 'development' | 'build', Record<Rotation, StationId[][]>> = {
  foundation: {
    A: [['sled-push', 'sled-pull'], ['farmers-carry', 'sandbag-lunges'], ['sled-push', 'sled-pull']],
    B: [['skierg', 'burpee-broad-jumps'], ['row', 'wall-balls'], ['skierg', 'burpee-broad-jumps']],
  },
  development: {
    A: [['sled-push', 'sled-pull', 'farmers-carry'], ['sandbag-lunges', 'sled-push'], ['sled-pull', 'farmers-carry', 'sandbag-lunges']],
    B: [['skierg', 'burpee-broad-jumps', 'wall-balls'], ['row', 'wall-balls'], ['skierg', 'row', 'burpee-broad-jumps']],
  },
  build: {
    A: [['sled-push', 'sled-pull'], ['farmers-carry', 'sandbag-lunges'], ['sled-push']],
    B: [['skierg', 'burpee-broad-jumps'], ['row', 'wall-balls'], ['skierg']],
  },
}

const PHASE_RUN = { foundation: 600, development: 700, build: 800 } as const

/** A jog, then lunges ticked off: the same 7 minutes. Station prep is the Set up's. */
const hyroxWarmUp: Block[] = [
  { name: 'Warm-up', minutes: 5, exercises: [easyJog(5)] },
  { name: 'Lunges', minutes: 2, exercises: [drill('Lunges', 2, { reps: 10 })] },
]

/**
 * Every Station the rounds use, once, in the order they come up, at the load
 * the first round asks for. They stay set up for the whole Session.
 */
function setUp(rounds: { stations: Exercise[] }[]): Block {
  const seen = new Map<StationId, Exercise>()
  for (const { prescription: rx } of rounds.flatMap((r) => r.stations)) {
    if (rx.kind !== 'station' || seen.has(rx.station)) continue
    seen.set(rx.station, {
      name: stations[rx.station].name,
      prescription: { kind: 'station', station: rx.station, raceLoadPercent: rx.raceLoadPercent },
    })
  }
  return { name: 'Set up', setup: true, exercises: [...seen.values()] }
}

const hyroxCooldown: Block = {
  name: 'Cooldown',
  minutes: 5,
  exercises: [walk(5, 'Walk, relaxed breathing', 'No extra finisher.')],
}

function circuit(
  rounds: { runMeters: number; stations: Exercise[] }[],
  roundMinutes: number,
  { key = false, minutes = 45, headline = `${rounds.length} rounds`, note = 'Technique before speed.' } = {},
): Session {
  return {
    id: 'hyrox',
    type: 'hyrox',
    headline,
    minutes,
    key,
    optional: false,
    note,
    blocks: [
      ...hyroxWarmUp,
      setUp(rounds),
      ...rounds.map((round, i) => ({
        name: `Round ${i + 1}`,
        minutes: roundMinutes,
        main: true,
        exercises: [{ name: 'Run', prescription: { kind: 'run' as const, meters: round.runMeters } }, ...round.stations],
      })),
      hyroxCooldown,
    ],
  }
}

function hyrox(
  phase: 'foundation' | 'development' | 'build',
  rotation: Rotation,
  percent: number,
  key = false,
): Session {
  const rounds = ROUNDS[phase][rotation].map((ids) => ({
    runMeters: PHASE_RUN[phase],
    stations: ids.map((id) => station(id, VOLUME[phase][id], percent)),
  }))
  return circuit(rounds, phase === 'foundation' ? 11 : 12, { key, minutes: phase === 'foundation' ? 45 : 50 })
}

/** Deload: a technique circuit at about two thirds of the Phase's volume, light. */
function hyroxTechnique(phase: 'foundation' | 'development' | 'build', rotation: Rotation): Session {
  const rounds = ROUNDS[phase][rotation].slice(0, 2).map((ids) => ({
    runMeters: PHASE_RUN[phase],
    stations: ids.map((id) => station(id, VOLUME[phase][id], 60)),
  }))
  return circuit(rounds, 10, { headline: 'technique circuit', minutes: 32, note: 'Deload: smooth technique, no pushing.' })
}

const raceVolume = (id: StationId): Volume => {
  const { meters, reps } = stations[id].raceLoad
  return { meters, reps }
}

const halfRaceVolume = (id: StationId): Volume => {
  const { meters, reps } = stations[id].raceLoad
  return { meters: meters && meters / 2, reps: reps && reps / 2 }
}

/** Race specific: 1 km and one full Station at Race load, three rounds. */
const hyroxRaceSpecific = circuit(
  (['sled-push', 'sled-pull', 'sandbag-lunges'] as const).map((id) => ({
    runMeters: 1000,
    stations: [station(id, raceVolume(id), 100)],
  })),
  11,
  { key: true, minutes: 50, note: 'Full race volume of each Station.' },
)

/** Week 25: 800 m and one Station at Race load, controlled, ahead of the final 5K test. */
const hyroxControlled = circuit(
  (['sled-push', 'farmers-carry', 'sandbag-lunges'] as const).map((id) => ({
    runMeters: 800,
    stations: [station(id, VOLUME.build[id], 100)],
  })),
  10,
  { minutes: 42, note: 'Race load, controlled. Save the legs for the 5K test.' },
)

function raceSimulation(headline: string, ids: readonly StationId[], volume: (id: StationId) => Volume, minutes: number): Session {
  return {
    id: 'race-simulation',
    type: 'race-simulation',
    headline,
    minutes,
    key: true,
    optional: false,
    note: 'Race order and Race load. Conservative first run, RPE 8, not all-out.',
    blocks: [
      {
        name: 'Warm-up',
        minutes: 10,
        exercises: [easyJog(7), { name: 'Station prep', prescription: { kind: 'note' }, note: 'Set up every Station before the first run.' }],
      },
      ...ids.map((id, i) => ({
        name: `Run and Station ${stations[id].order}`,
        main: true,
        exercises: [
          {
            name: 'Run',
            prescription: { kind: 'run' as const, meters: 1000, effort: { feel: 'hard', rpe: [8, 8] } as RunEffort },
            note: i === 0 ? 'Conservative.' : undefined,
          },
          station(id, volume(id), 100),
        ],
      })),
      { name: 'Cooldown', minutes: 5, exercises: [walk(5, 'Walk, relaxed breathing')] },
    ],
  }
}

const halfSimulationA = raceSimulation('half A', RACE_ORDER.slice(0, 4), raceVolume, 65)
const halfSimulationB = raceSimulation('half B', RACE_ORDER.slice(4), raceVolume, 65)
/** Week 24: all eight 1 km runs, every Station at half race volume and full Race load. */
const fullRunSimulation = raceSimulation('full run', RACE_ORDER, halfRaceVolume, 80)

// ---------------------------------------------------------------------------
// Week by week.

const week = (
  number: number,
  startDate: string,
  sessions: Session[],
  flags: Partial<Pick<Week, 'deload' | 'fiveKTest' | 'raceSimulation' | 'race' | 'notes'>> = {},
): Week => ({
  number,
  startDate: localDate(startDate),
  deload: false,
  fiveKTest: sessions.some((s) => s.type === '5k-test'),
  raceSimulation: sessions.some((s) => s.type === 'race-simulation'),
  race: false,
  ...flags,
  sessions,
})

const iv = (reps: number, workSeconds: number, recoverySeconds: number, effort: RunEffort = AT_5K): Intervals => ({
  reps,
  workSeconds,
  recoverySeconds,
  effort,
})

const foundation: Week[] = [
  week(1, '2026-10-19', [
    speed(iv(5, 120, 120, HARD), 2, 1),
    strength('build', { calibration: true }),
    threshold(3, 7, 120, true),
    hyrox('foundation', 'A', 60),
    easyRun(20),
  ]),
  week(2, '2026-10-26', [
    fiveKTest(2),
    strength('build'),
    threshold(3, 7, 120, false),
    hyrox('foundation', 'B', 60),
    easyRun(20),
  ]),
  week(3, '2026-11-02', [
    speed(iv(5, 180, 90, HARD), 4, 3),
    strength('build'),
    threshold(2, 12, 120, true),
    hyrox('foundation', 'A', 60),
    easyRun(25),
  ]),
  week(
    4,
    '2026-11-09',
    [speedDeload, strength('build', { deload: true }), easyInsteadOfThreshold, hyroxTechnique('foundation', 'B'), easyRun(25)],
    { deload: true },
  ),
  week(5, '2026-11-16', [
    speed(iv(5, 180, 90), 4, 5),
    strength('build'),
    threshold(2, 12, 120, true),
    hyrox('foundation', 'A', 60),
    easyRun(30),
  ]),
  week(6, '2026-11-23', [
    speed(iv(4, 240, 120), 4, 6),
    strength('build'),
    threshold(2, 12, 120, true),
    hyrox('foundation', 'B', 60),
    easyRun(30),
  ]),
]

const development: Week[] = [
  week(7, '2026-11-30', [
    speed(iv(4, 240, 90), 4, 7, true),
    strength('build'),
    threshold(3, 8, 90, false),
    hyrox('development', 'A', 70),
    easyRun(35),
  ]),
  week(
    8,
    '2026-12-07',
    [speedDeload, strength('build', { deload: true }), easyInsteadOfThreshold, hyroxTechnique('development', 'B'), easyRun(30)],
    { deload: true },
  ),
  week(9, '2026-12-14', [
    fiveKTest(9),
    strength('build'),
    threshold(3, 8, 90, false),
    hyrox('development', 'A', 70),
    easyRun(35),
  ]),
  week(10, '2026-12-21', [
    speed(iv(5, 180, 90), 4, 10, true),
    strength('build'),
    threshold(3, 8, 90, false),
    hyrox('development', 'B', 75),
    easyRun(40),
  ]),
  week(11, '2026-12-28', [
    speed(iv(4, 240, 90), 4, 11, true),
    strength('build'),
    threshold(3, 8, 90, false),
    hyrox('development', 'A', 75),
    easyRun(40),
  ]),
  week(
    12,
    '2027-01-04',
    [speedDeload, strength('build', { deload: true }), easyInsteadOfThreshold, hyroxTechnique('development', 'B'), easyRun(30)],
    { deload: true },
  ),
  week(13, '2027-01-11', [
    speed(iv(3, 300, 120), 4, 13, true),
    strength('build'),
    threshold(4, 6, 60, false),
    hyrox('development', 'A', 80),
    easyRun(45),
  ]),
  week(14, '2027-01-18', [
    speed(iv(6, 120, 90, { pace: '5k', secondsPerKmFaster: 5 }), 4, 14, true),
    strength('build'),
    threshold(4, 6, 60, false),
    hyrox('development', 'B', 80),
    easyRun(45),
  ]),
]

const build: Week[] = [
  week(15, '2027-01-25', [
    speed(iv(4, 180, 120), 3, 15),
    strength('maintenance'),
    threshold(2, 10, 120, false),
    hyrox('build', 'A', 90, true),
    easyRun(50),
  ]),
  week(
    16,
    '2027-02-01',
    [speedDeload, strength('maintenance', { deload: true }), easyInsteadOfThreshold, hyroxTechnique('build', 'B'), easyRun(35)],
    { deload: true },
  ),
  week(17, '2027-02-08', [
    fiveKTest(17),
    strength('maintenance'),
    threshold(2, 10, 120, false),
    hyrox('build', 'A', 90),
    easyRun(50),
  ]),
  week(18, '2027-02-15', [
    speed(iv(4, 180, 120), 3, 18),
    strength('maintenance'),
    threshold(2, 10, 120, false),
    halfSimulationA,
    easyRun(45),
  ]),
  week(19, '2027-02-22', [
    speed(iv(5, 180, 120), 3, 19),
    strength('maintenance'),
    threshold(2, 10, 120, false),
    hyrox('build', 'B', 95, true),
    easyRun(55),
  ]),
  week(20, '2027-03-01', [
    speed(iv(4, 180, 120), 3, 20),
    strength('maintenance'),
    threshold(2, 10, 120, false),
    hyrox('build', 'A', 100, true),
    easyRun(55),
  ]),
  week(21, '2027-03-08', [
    speed(iv(5, 180, 120), 3, 21),
    strength('maintenance'),
    threshold(2, 10, 120, false),
    halfSimulationB,
    easyRun(45),
  ]),
  week(
    22,
    '2027-03-15',
    [speedDeload, strength('maintenance', { deload: true }), easyInsteadOfThreshold, hyroxTechnique('build', 'B'), easyRun(40)],
    { deload: true },
  ),
]

const raceSpecific: Week[] = [
  week(23, '2027-03-22', [
    speed(iv(4, 180, 120), 3, 23),
    strength('maintenance'),
    threshold(2, 10, 120, false),
    hyroxRaceSpecific,
    easyRun(60, { note: 'The long run. Full sentences. No tempo, no hills.' }),
  ]),
  week(24, '2027-03-29', [
    speed(iv(4, 180, 120), 3, 24),
    strength('maintenance'),
    threshold(2, 10, 120, false),
    fullRunSimulation,
    easyRun(45),
  ]),
  week(25, '2027-04-05', [
    fiveKTest(25),
    strength('maintenance'),
    threshold(2, 8, 120, false),
    hyroxControlled,
    easyRun(45),
  ]),
]

const RACE_DAY = localDate('2027-04-21')

const race: Session = {
  id: 'race',
  type: 'hyrox',
  headline: 'race day',
  minutes: 90,
  key: true,
  optional: false,
  date: RACE_DAY,
  note: 'Men’s Open. Pace the first run conservatively.',
  blocks: [
    { name: 'Warm-up', minutes: 15, exercises: [easyJog(10), walk(5, 'Station prep and strides')] },
    {
      name: 'Race',
      main: true,
      exercises: RACE_ORDER.flatMap((id) => [
        { name: 'Run', prescription: { kind: 'run' as const, meters: 1000 } },
        station(id, raceVolume(id), 100),
      ]),
    },
  ],
}

const taper: Week[] = [
  week(
    26,
    '2027-04-12',
    [
      speedTaper,
      strengthTaper,
      easyRun(30, {
        id: 'easy-strides',
        optional: false,
        note: 'In place of Threshold. No threshold work.',
        extra: [{ name: 'Strides', prescription: { kind: 'strides', reps: 4, seconds: 15 }, note: 'Relaxed' }],
      }),
      {
        id: 'rest',
        type: 'easy',
        headline: 'rest or walk',
        minutes: 15,
        key: false,
        optional: true,
        note: 'In place of HYROX. No circuit.',
        blocks: [{ name: 'Walk', minutes: 15, main: true, exercises: [walk(15, 'Easy walk', 'Or rest.')] }],
      },
      easyRun(20, { note: 'Only if fresh.' }),
    ],
  ),
  week(
    27,
    '2027-04-19',
    [
      easyRun(20, {
        id: 'shakeout',
        note: 'Monday, or rest if tired.',
        extra: [{ name: 'Strides', prescription: { kind: 'strides', reps: 3, seconds: 15 }, note: 'Relaxed' }],
      }),
      race,
    ],
    {
      race: true,
      notes: [
        'Tuesday: rest. Prepare kit; familiar meals and hydration.',
        'Wednesday 21 April: race.',
        'Thursday: recovery, walking only as comfortable.',
      ],
    },
  ),
]

export const program: Program = {
  version: 2,
  raceDay: RACE_DAY,
  weekCount: 27,
  stations,
  phases: [
    { id: 'foundation', name: 'Foundation', firstWeek: 1, lastWeek: 6, weeks: foundation },
    { id: '5k-development', name: '5K development', firstWeek: 7, lastWeek: 14, weeks: development },
    { id: 'hyrox-build', name: 'HYROX build', firstWeek: 15, lastWeek: 22, weeks: build },
    { id: 'race-specific', name: 'Race specific', firstWeek: 23, lastWeek: 25, weeks: raceSpecific },
    { id: 'taper', name: 'Taper', firstWeek: 26, lastWeek: 27, weeks: taper },
  ],
}
