/**
 * The approved Program (docs/training-plan.md, approved 7 Nov 2026) as data.
 *
 * All 24 Weeks, built from the Session templates in the plan. Where the plan
 * leaves a detail open (which Station a three-round HYROX Session drops, the
 * Deload volumes of the accessory lifts) the choice is made once here and
 * commented.
 */
import { addDays, localDate } from '../calendar'
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
  Week,
} from './types'

// ---------------------------------------------------------------------------
// Race loads: Men's Open and Doubles, verified on hyrox.com 7 Nov 2026, in pounds.

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

const strides = (reps: number): Exercise => ({
  name: 'Strides',
  prescription: { kind: 'strides', reps, seconds: 15 },
  note: 'Relaxed',
})

type Volume = { meters?: number; reps?: number }

/** One Station at a Station volume, at Race load: the load never changes, only the volume. */
const station = (id: StationId, volume: Volume): Exercise => ({
  name: stations[id].name,
  prescription: { kind: 'station', station: id, ...volume },
})

const raceVolume = (id: StationId): Volume => {
  const { meters, reps } = stations[id].raceLoad
  return { meters, reps }
}

const halfRaceVolume = (id: StationId): Volume => {
  const { meters, reps } = stations[id].raceLoad
  return { meters: meters && meters / 2, reps: reps && reps / 2 }
}

// ---------------------------------------------------------------------------
// HYROX A and HYROX B: four rounds of a Station, then a run.

type Rotation = 'A' | 'B'

/** HYROX A loads the sleds and carries; HYROX B the ergs, the jumps and the ball. Each in race order, wall balls last. */
const ROTATION: Record<Rotation, StationId[]> = {
  A: ['sled-push', 'sled-pull', 'farmers-carry', 'sandbag-lunges'],
  B: ['skierg', 'burpee-broad-jumps', 'row', 'wall-balls'],
}

/** The Station volume table's four columns (training-plan.md, "Station volume per Session"). */
export type VolumeTier = 'foundation' | 'build-early' | 'build-late' | 'race-specific'

/** Each Station's volume per round, by tier. */
export const STATION_VOLUME: Record<VolumeTier, Record<StationId, Volume>> = {
  foundation: {
    skierg: { meters: 250 },
    'sled-push': { meters: 25 },
    'sled-pull': { meters: 25 },
    'burpee-broad-jumps': { meters: 20 },
    row: { meters: 250 },
    'farmers-carry': { meters: 100 },
    'sandbag-lunges': { meters: 25 },
    'wall-balls': { reps: 25 },
  },
  'build-early': {
    skierg: { meters: 500 },
    'sled-push': { meters: 25 },
    'sled-pull': { meters: 25 },
    'burpee-broad-jumps': { meters: 40 },
    row: { meters: 500 },
    'farmers-carry': { meters: 100 },
    'sandbag-lunges': { meters: 50 },
    'wall-balls': { reps: 50 },
  },
  'build-late': {
    skierg: { meters: 750 },
    'sled-push': { meters: 50 },
    'sled-pull': { meters: 50 },
    'burpee-broad-jumps': { meters: 60 },
    row: { meters: 750 },
    'farmers-carry': { meters: 200 },
    'sandbag-lunges': { meters: 75 },
    'wall-balls': { reps: 75 },
  },
  'race-specific': Object.fromEntries(RACE_ORDER.map((id) => [id, raceVolume(id)])) as Record<StationId, Volume>,
}

/**
 * The run after each Station, by tier. HYROX B's stay at 600 m in Race
 * specific: its Stations take about twice as long as A's.
 */
export const RUN_METERS: Record<VolumeTier, Record<Rotation, number>> = {
  foundation: { A: 400, B: 400 },
  'build-early': { A: 600, B: 600 },
  'build-late': { A: 800, B: 800 },
  'race-specific': { A: 1000, B: 600 },
}

/**
 * Three rounds drop one Station: the Coach drops the one done best last time
 * (stations.ts). Until the logs say which, the one dropped is the middle
 * Station that is least technical: the farmers carry in A, the row in B.
 * Wall balls stay last.
 */
const THREE_ROUNDS: Record<Rotation, StationId[]> = {
  A: ['sled-push', 'sled-pull', 'sandbag-lunges'],
  B: ['skierg', 'burpee-broad-jumps', 'wall-balls'],
}

/** The Taper's last Week: two rounds, the first and last Station of each. */
const TWO_ROUNDS: Record<Rotation, StationId[]> = {
  A: ['sled-push', 'sandbag-lunges'],
  B: ['skierg', 'wall-balls'],
}

const HYROX_WARM_UP: Block = { name: 'Warm-up', minutes: 5, exercises: [easyJog(5)] }

const HYROX_COOLDOWN: Block = {
  name: 'Cooldown',
  minutes: 4,
  exercises: [walk(4, 'Walk, relaxed breathing', 'No extra finisher.')],
}

/**
 * Every Station the rounds load, once, in the order they come up, at Race
 * load. They stay set up for the whole Session. Stations with nothing to
 * load (SkiErg, row, burpee broad jumps) are left out, and the note says so once.
 */
function setUp(ids: StationId[]): Block {
  const loaded = ids.filter((id) => stations[id].raceLoad.pounds !== undefined)
  return {
    name: 'Set up',
    setup: true,
    exercises: loaded.map((id) => ({ name: stations[id].name, prescription: { kind: 'station', station: id } })),
    ...(loaded.length < ids.length && { note: 'Nothing else to load.' }),
  }
}

interface Circuit {
  rotation: Rotation
  ids: StationId[]
  /** A three-round Session's left-out Station, kept as its spare round. */
  spare?: StationId
  volume: (id: StationId) => Volume
  runMeters: number
  key?: boolean
  minutes?: number
  note?: string
}

/** A round is one Station at its Station volume, then the run: every run a Compromised run. */
function hyrox({ rotation, ids, spare, volume, runMeters, key = false, minutes = 45, note }: Circuit): Session {
  const roundMinutes = (minutes - HYROX_WARM_UP.minutes! - HYROX_COOLDOWN.minutes!) / ids.length
  const round = (id: StationId, i: number): Block => ({
    name: `Round ${i + 1}`,
    minutes: roundMinutes,
    main: true,
    exercises: [station(id, volume(id)), { name: 'Run', prescription: { kind: 'run', meters: runMeters } }],
  })
  return {
    id: rotation === 'A' ? 'hyrox-a' : 'hyrox-b',
    type: 'hyrox',
    name: `HYROX ${rotation}`,
    headline: `${ids.length} rounds`,
    minutes,
    key,
    optional: false,
    note,
    blocks: [
      HYROX_WARM_UP,
      setUp(ids),
      ...ids.map(round),
      HYROX_COOLDOWN,
    ],
    ...(spare && { spareRound: round(spare, ids.length) }),
  }
}

/** A normal Week's HYROX: four rounds at the tier's Station volume. */
const fourRounds = (rotation: Rotation, tier: VolumeTier, key = false): Session =>
  hyrox({
    rotation,
    ids: ROTATION[rotation],
    volume: (id) => STATION_VOLUME[tier][id],
    runMeters: RUN_METERS[tier][rotation],
    key,
    note: tier === 'foundation' ? 'Technique before speed.' : undefined,
  })

/** A Deload week's HYROX: three rounds, Race load and volume kept. Week 20 halves the volume too. */
const threeRounds = (rotation: Rotation, tier: VolumeTier, { half = false } = {}): Session =>
  hyrox({
    rotation,
    ids: THREE_ROUNDS[rotation],
    spare: ROTATION[rotation].find((id) => !THREE_ROUNDS[rotation].includes(id)),
    volume: half ? halfRaceVolume : (id) => STATION_VOLUME[tier][id],
    runMeters: RUN_METERS[tier][rotation],
    minutes: 36,
    note: 'Race load kept. Smooth, no pushing.',
  })

/** The Taper's HYROX: Stations at half race volume, fewer rounds and shorter runs, Race load kept. */
const taperRounds = (rotation: Rotation, rounds: 3 | 2, key = false): Session =>
  hyrox({
    rotation,
    ids: rounds === 3 ? THREE_ROUNDS[rotation] : TWO_ROUNDS[rotation],
    volume: halfRaceVolume,
    runMeters: rounds === 3 ? 600 : 400,
    minutes: rounds === 3 ? 30 : 20,
    key,
    note: 'Race load, short. Stop well before tired.',
  })

// ---------------------------------------------------------------------------
// Run: Threshold intervals, or Compromised intervals from Build on.

const AT_THRESHOLD: RunEffort = { pace: 'threshold', rpe: THRESHOLD_RPE }
const AT_RACE_RUN: RunEffort = { pace: 'race-run' }

function thresholdRun(reps: number, repMinutes: number, key = false): Session {
  const work = reps * repMinutes + ((reps - 1) * 90) / 60
  // Longer sets warm up for 7 minutes, so the whole Run still fits the Session cap.
  const warmUp = work > 28 ? 7 : 10
  const cooldown = 45 - warmUp - work
  return {
    id: 'run',
    type: 'run',
    headline: `${reps} × ${repMinutes}′`,
    minutes: 45,
    key,
    optional: false,
    blocks: [
      { name: 'Warm-up', minutes: warmUp, exercises: [easyJog(warmUp)] },
      {
        name: 'Threshold',
        minutes: work,
        main: true,
        exercises: [
          {
            name: 'Threshold reps',
            prescription: { kind: 'intervals', reps, workSeconds: repMinutes * 60, recoverySeconds: 90, recovery: 'jog', effort: AT_THRESHOLD },
            note: 'Never racing.',
          },
        ],
      },
      { name: 'Cooldown', minutes: cooldown, exercises: [easyJog(cooldown)] },
    ],
  }
}

/** Compromised intervals: 1 km at Race run pace, then 20 wall balls, 60″ rest between. */
function compromisedIntervals(reps: number, key = false): Session {
  const repMinutes = 6
  const work = reps * repMinutes
  const warmUp = reps > 4 ? 7 : 10
  const cooldown = 45 - warmUp - work
  return {
    id: 'run',
    type: 'run',
    headline: `${reps} × (1 km + 20 wall balls)`,
    minutes: 45,
    key,
    optional: false,
    note: 'No ball at hand: 20 air squats + 10 burpees for the wall balls.',
    blocks: [
      { name: 'Warm-up', minutes: warmUp, exercises: [easyJog(warmUp)] },
      ...Array.from(
        { length: reps },
        (_, i): Block => ({
          name: `Rep ${i + 1}`,
          minutes: repMinutes,
          main: true,
          note: i < reps - 1 ? '60″ rest after.' : undefined,
          exercises: [
            { name: 'Run', prescription: { kind: 'run', meters: 1000, effort: AT_RACE_RUN } },
            station('wall-balls', { reps: 20 }),
          ],
        }),
      ),
      { name: 'Cooldown', minutes: cooldown, exercises: [easyJog(cooldown)] },
    ],
  }
}

/** A Deload week's Run: 35 minutes easy. */
const deloadRun: Session = {
  id: 'run',
  type: 'run',
  headline: '35′ easy',
  minutes: 35,
  key: false,
  optional: false,
  blocks: [
    {
      name: 'Easy run',
      minutes: 35,
      main: true,
      exercises: [{ ...easyJog(35, 'Easy run'), note: 'Deload: easy in place of the intervals. Full sentences.' }],
    },
  ],
}

/** Week 23's Run: 20 minutes easy, then four 1′ pickups at Race run pace. */
const taperPickups: Session = {
  id: 'run',
  type: 'run',
  headline: '20′ easy + 4 × 1′',
  minutes: 25,
  key: true,
  optional: false,
  blocks: [
    { name: 'Easy run', minutes: 20, exercises: [easyJog(20, 'Easy run')] },
    {
      name: 'Pickups',
      minutes: 5,
      main: true,
      exercises: [
        {
          name: 'Pickups',
          prescription: { kind: 'intervals', reps: 4, workSeconds: 60, recoverySeconds: 20, recovery: 'jog', effort: AT_RACE_RUN },
        },
      ],
    },
  ],
}

/** Week 22's Run: 3 × 5′ at Threshold, about 30′. */
const taperThreshold: Session = {
  ...thresholdRun(3, 5),
  minutes: 30,
  blocks: [
    { name: 'Warm-up', minutes: 8, exercises: [easyJog(8)] },
    {
      name: 'Threshold',
      minutes: 18,
      main: true,
      exercises: [
        {
          name: 'Threshold reps',
          prescription: { kind: 'intervals', reps: 3, workSeconds: 300, recoverySeconds: 90, recovery: 'jog', effort: AT_THRESHOLD },
          note: 'Never racing.',
        },
      ],
    },
    { name: 'Cooldown', minutes: 4, exercises: [easyJog(4)] },
  ],
}

// ---------------------------------------------------------------------------
// Compromised run test: four rounds of 1 km at full effort, then a Station at half race volume.

const TEST_STATIONS = ['skierg', 'sled-push', 'row', 'wall-balls'] as const satisfies readonly StationId[]

const TEST_NAMES = { 2: 'baseline', 9: 'second', 14: 'third', 19: 'final' } as const

function compromisedRunTest(week: keyof typeof TEST_NAMES): Session {
  return {
    id: 'compromised-run-test',
    type: 'compromised-run-test',
    headline: TEST_NAMES[week],
    minutes: 45,
    key: true,
    optional: false,
    note: 'Indoors: treadmill at 1% incline. The average of the four runs becomes Race run pace.',
    blocks: [
      {
        name: 'Warm-up',
        minutes: 8,
        exercises: [easyJog(8), { name: 'Station prep', prescription: { kind: 'note' }, note: 'Set up every Station before the first run.' }],
      },
      { name: 'Strides', minutes: 2, exercises: [strides(2)] },
      ...TEST_STATIONS.map(
        (id, i): Block => ({
          name: `Run and ${stations[id].name}`,
          main: true,
          exercises: [
            { name: 'Run', prescription: { kind: 'run', meters: 1000, effort: { feel: 'all-out' } }, note: i === 0 ? 'Full effort.' : undefined },
            station(id, halfRaceVolume(id)),
          ],
        }),
      ),
      { name: 'Cooldown', minutes: 4, exercises: [easyJog(4)] },
    ],
  }
}

// ---------------------------------------------------------------------------
// Strength: squat, RDL, split squat, the heavy carry and the calves.

type StrengthPhase = 'build' | 'maintenance'
type Sets = Extract<Prescription, { kind: 'sets' }>

/** The same sets on the other lift: a machine's loads aren't a dumbbell's, so each has its own Working weight. */
function onLift(rx: Sets, lift: LiftId): Sets {
  return 'lift' in rx.load ? { ...rx, load: { ...rx.load, lift } } : rx
}

/**
 * Calf raises as the Program writes them, on the machines. The athlete's gym
 * has none, so the Equipment profile swaps in the dumbbell single-leg raise
 * and the loaded seated raise. `rx` is written for the dumbbell lift.
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

const heavyCarry = (sets: number, load: StrengthLoad, rpe?: Range, rpeCap?: number): Exercise => ({
  name: 'Heavy farmers carry',
  prescription: { kind: 'sets', sets, reps: 1, meters: 40, load, rpe, rpeCap },
  note: 'Dumbbells, heavier than Race load when possible',
})

const STRENGTH_WARM_UP: Block = {
  name: 'Warm-up',
  minutes: 6,
  exercises: [{ name: 'Bike, movement prep and ramp-up sets', prescription: { kind: 'note', minutes: 6 } }],
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
    headline: calibration ? 'find Working weights' : deload ? 'deload' : `squat ${squat.sets} × ${squat.reps}`,
    minutes: deload ? 30 : 45,
    key: false,
    optional: false,
    note: 'At least 3 hours from any run, and first when they share a day.',
    blocks: [
      STRENGTH_WARM_UP,
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
      // From Race specific the split squat is dropped: strength kept without the fatigue.
      ...(build
        ? [
            {
              name: 'Unilateral',
              exercises: [
                {
                  name: 'Bulgarian split squat',
                  prescription: { kind: 'sets', sets: sets(2), reps: 6, perLeg: true, load: load('bulgarian-split-squat'), rpe: rpe7, rpeCap },
                } satisfies Exercise,
              ],
            },
          ]
        : []),
      { name: 'Carry', exercises: [heavyCarry(sets(build ? 3 : 2), load('heavy-farmers-carry'), rpe7, rpeCap)] },
      {
        name: 'Tendon',
        exercises: [
          standingCalfRaise({ kind: 'sets', sets: sets(3), reps: 8, perLeg: true, load: load('single-leg-calf-raise') }),
          seatedCalfRaise({ kind: 'sets', sets: sets(2), reps: 10, load: load('seated-calf-raise') }),
        ],
      },
    ],
  }
}

/** Week 22: squat and RDL 2 × 4 at RPE 7, carries 2 × 40 m, calves 2 × 8. */
const strengthTaper: Session = {
  id: 'strength',
  type: 'strength',
  headline: 'squat 2 × 4',
  minutes: 30,
  key: false,
  optional: false,
  blocks: [
    STRENGTH_WARM_UP,
    {
      name: 'Strength',
      main: true,
      exercises: [
        { name: 'Back squat', prescription: { kind: 'sets', sets: 2, reps: 4, load: { kind: 'working-weight', lift: 'back-squat' }, rpe: [7, 7] } },
        {
          name: 'Romanian deadlift',
          prescription: { kind: 'sets', sets: 2, reps: 4, load: { kind: 'working-weight', lift: 'romanian-deadlift' }, rpe: [7, 7] },
        },
      ],
    },
    { name: 'Carry', exercises: [heavyCarry(2, { kind: 'working-weight', lift: 'heavy-farmers-carry' })] },
    {
      name: 'Tendon',
      exercises: [standingCalfRaise({ kind: 'sets', sets: 2, reps: 8, perLeg: true, load: { kind: 'working-weight', lift: 'single-leg-calf-raise' } })],
    },
  ],
}

/** Week 23: light technique only, no heavy lowering. */
const strengthLight: Session = {
  id: 'strength',
  type: 'strength',
  headline: 'light technique',
  minutes: 20,
  key: false,
  optional: false,
  note: 'No heavy lowering.',
  blocks: [
    { name: 'Warm-up', minutes: 5, exercises: [{ name: 'Bike and movement prep', prescription: { kind: 'note', minutes: 5 } }] },
    {
      name: 'Strength',
      main: true,
      exercises: [
        { name: 'Back squat', prescription: { kind: 'sets', sets: 2, reps: 3, load: { kind: 'light', lift: 'back-squat' } } },
        { name: 'Romanian deadlift', prescription: { kind: 'sets', sets: 2, reps: 3, load: { kind: 'light', lift: 'romanian-deadlift' } } },
      ],
    },
    {
      name: 'Tendon',
      exercises: [standingCalfRaise({ kind: 'sets', sets: 2, reps: 8, perLeg: true, load: { kind: 'light', lift: 'single-leg-calf-raise' } })],
    },
  ],
}

// ---------------------------------------------------------------------------
// The Easy run, Optional, growing into the long run.

function easyRun(minutes: number, { note = 'Full sentences. No tempo, no hills.', extra = [] as Exercise[], id = 'easy' } = {}): Session {
  return {
    id,
    type: 'easy',
    headline: `${minutes}′`,
    minutes,
    key: false,
    optional: true,
    blocks: [{ name: 'Easy run', minutes, main: true, exercises: [{ ...easyJog(minutes, 'Easy run'), note }, ...extra] }],
  }
}

const LONG_RUN = 'The long run. Full sentences. No tempo, no hills.'

/**
 * The second Easy run, in Build and Race specific: offered only in a Week
 * after one whose four required Sessions were all Done. Optional like the
 * first. Not in the Taper, which cuts volume and keeps frequency.
 */
const secondEasyRun: Session = {
  ...easyRun(25, { id: 'easy-2', note: 'A second easy run, for keeping up: 25 to 30 minutes. Full sentences.' }),
  name: 'Second Easy run',
  headline: '25–30′',
  afterFullWeek: true,
}

/** Every Week of Build and Race specific also holds the second Easy run, last in its Bucket. */
const withSecondEasyRun = (weeks: Week[]): Week[] => weeks.map((w) => ({ ...w, sessions: [...w.sessions, secondEasyRun] }))

// ---------------------------------------------------------------------------
// Race simulations: race order, Race load, exempt from the Session cap.

function raceSimulation(headline: string, ids: readonly StationId[], volume: (id: StationId) => Volume, minutes: number): Session {
  return {
    id: 'race-simulation',
    type: 'race-simulation',
    headline,
    minutes,
    key: true,
    optional: false,
    note: 'Race order and Race load. Conservative first run, RPE 8, not all-out. With the partner when possible, each taking half of every Station.',
    blocks: [
      {
        name: 'Warm-up',
        minutes: 10,
        exercises: [easyJog(7), { name: 'Station prep', prescription: { kind: 'note' }, note: 'Set up every Station before the first run.' }],
      },
      ...ids.map(
        (id, i): Block => ({
          name: `Run and Station ${stations[id].order}`,
          main: true,
          exercises: [
            {
              name: 'Run',
              prescription: { kind: 'run', meters: 1000, effort: { feel: 'hard', rpe: [8, 8] } },
              note: i === 0 ? 'Conservative.' : undefined,
            },
            station(id, volume(id)),
          ],
        }),
      ),
      { name: 'Cooldown', minutes: 5, exercises: [walk(5, 'Walk, relaxed breathing')] },
    ],
  }
}

const halfSimulationA = raceSimulation('half A', RACE_ORDER.slice(0, 4), raceVolume, 65)
const halfSimulationB = raceSimulation('half B', RACE_ORDER.slice(4), raceVolume, 65)
/** Week 21: all eight 1 km runs, every Station at half race volume and Race load. */
const fullRunSimulation = raceSimulation('full run', RACE_ORDER, halfRaceVolume, 80)

// ---------------------------------------------------------------------------
// Race week.

const RACE_DAY = localDate('2027-04-22')

const race: Session = {
  id: 'race',
  type: 'hyrox',
  headline: 'race day',
  minutes: 90,
  key: true,
  optional: false,
  date: RACE_DAY,
  note: 'HYROX Doubles. Pace the first run conservatively; agree the Station split with the partner beforehand.',
  blocks: [
    { name: 'Warm-up', minutes: 15, exercises: [easyJog(10), walk(5, 'Station prep and strides')] },
    {
      name: 'Race',
      main: true,
      exercises: RACE_ORDER.flatMap((id) => [{ name: 'Run', prescription: { kind: 'run' as const, meters: 1000 } }, station(id, raceVolume(id))]),
    },
  ],
}

/** Tuesday's Station touch: a sled push and a few wall balls at Race load, or rest. */
const stationTouch: Session = {
  id: 'station-touch',
  type: 'hyrox',
  name: 'Station touch',
  headline: 'sled push + wall balls',
  minutes: 15,
  key: false,
  optional: true,
  note: 'Tuesday, or rest. Race load; stop well before tired.',
  blocks: [
    { name: 'Warm-up', minutes: 5, exercises: [easyJog(5)] },
    setUp(['sled-push', 'wall-balls']),
    { name: 'Station touch', minutes: 10, main: true, exercises: [station('sled-push', { meters: 25 }), station('wall-balls', { reps: 20 })] },
  ],
}

// ---------------------------------------------------------------------------
// Week by week.

const PROGRAM_START = localDate('2026-11-09')

const week = (
  number: number,
  sessions: Session[],
  flags: Partial<Pick<Week, 'deload' | 'race' | 'notes'>> = {},
): Week => ({
  number,
  startDate: addDays(PROGRAM_START, 7 * (number - 1)),
  deload: false,
  compromisedRunTest: sessions.some((s) => s.type === 'compromised-run-test'),
  raceSimulation: sessions.some((s) => s.type === 'race-simulation'),
  race: false,
  ...flags,
  sessions,
})

/** A normal Week: HYROX A, HYROX B, the Run, Strength and the Easy run. */
const bucket = (a: Session, b: Session, run: Session, lift: Session, easy: Session) => [a, b, run, lift, easy]

const foundation: Week[] = [
  week(1, bucket(fourRounds('A', 'foundation'), fourRounds('B', 'foundation'), thresholdRun(3, 7, true), strength('build', { calibration: true }), easyRun(25))),
  week(2, bucket(fourRounds('A', 'foundation'), fourRounds('B', 'foundation'), compromisedRunTest(2), strength('build'), easyRun(25))),
  week(3, bucket(fourRounds('A', 'foundation', true), fourRounds('B', 'foundation'), thresholdRun(3, 8), strength('build'), easyRun(30))),
  week(4, bucket(fourRounds('A', 'foundation'), fourRounds('B', 'foundation', true), thresholdRun(4, 6), strength('build'), easyRun(30))),
  week(5, bucket(threeRounds('A', 'foundation'), threeRounds('B', 'foundation'), deloadRun, strength('build', { deload: true }), easyRun(25)), {
    deload: true,
  }),
]

const build: Week[] = [
  week(6, bucket(fourRounds('A', 'build-early', true), fourRounds('B', 'build-early'), compromisedIntervals(4), strength('build'), easyRun(35))),
  week(7, bucket(fourRounds('A', 'build-early'), fourRounds('B', 'build-early', true), thresholdRun(3, 8), strength('build'), easyRun(35))),
  week(8, bucket(fourRounds('A', 'build-early'), fourRounds('B', 'build-early'), compromisedIntervals(4, true), strength('build'), easyRun(40))),
  week(9, bucket(fourRounds('A', 'build-early'), fourRounds('B', 'build-early'), compromisedRunTest(9), strength('build'), easyRun(40))),
  week(10, bucket(threeRounds('A', 'build-early'), threeRounds('B', 'build-early'), deloadRun, strength('build', { deload: true }), easyRun(30)), {
    deload: true,
  }),
  week(11, bucket(fourRounds('A', 'build-late', true), fourRounds('B', 'build-late'), compromisedIntervals(5), strength('build'), easyRun(45))),
  week(12, bucket(fourRounds('A', 'build-late'), fourRounds('B', 'build-late', true), thresholdRun(4, 7), strength('build'), easyRun(45))),
  week(13, bucket(fourRounds('A', 'build-late'), fourRounds('B', 'build-late'), compromisedIntervals(5, true), strength('build'), easyRun(50))),
  week(14, bucket(fourRounds('A', 'build-late'), fourRounds('B', 'build-late'), compromisedRunTest(14), strength('build'), easyRun(50))),
  week(15, bucket(threeRounds('A', 'build-late'), threeRounds('B', 'build-late'), deloadRun, strength('build', { deload: true }), easyRun(35)), {
    deload: true,
  }),
]

/** Race specific: full Station volume; the Race simulations take HYROX A's place. */
const raceSpecific: Week[] = [
  week(16, bucket(halfSimulationA, fourRounds('B', 'race-specific'), thresholdRun(3, 8), strength('maintenance'), easyRun(55))),
  week(17, bucket(fourRounds('A', 'race-specific', true), fourRounds('B', 'race-specific'), compromisedIntervals(5), strength('maintenance'), easyRun(60, { note: LONG_RUN }))),
  week(18, bucket(halfSimulationB, fourRounds('B', 'race-specific'), thresholdRun(4, 6), strength('maintenance'), easyRun(50))),
  week(19, bucket(fourRounds('A', 'race-specific'), fourRounds('B', 'race-specific'), compromisedRunTest(19), strength('maintenance'), easyRun(60, { note: LONG_RUN }))),
  week(
    20,
    bucket(
      threeRounds('A', 'race-specific', { half: true }),
      threeRounds('B', 'race-specific', { half: true }),
      deloadRun,
      strength('maintenance', { deload: true }),
      easyRun(35),
    ),
    { deload: true },
  ),
  week(21, bucket(fullRunSimulation, threeRounds('B', 'race-specific', { half: true }), thresholdRun(3, 6), strength('maintenance'), easyRun(40))),
]

const taper: Week[] = [
  week(22, bucket(taperRounds('A', 3, true), taperRounds('B', 3), taperThreshold, strengthTaper, easyRun(30))),
  week(23, bucket(taperRounds('A', 2), taperRounds('B', 2), taperPickups, strengthLight, easyRun(20, { note: 'Only if fresh.' }))),
  week(
    24,
    [
      easyRun(20, { id: 'shakeout', note: 'Monday: an easy jog, or rest if tired.', extra: [strides(3)] }),
      stationTouch,
      race,
    ],
    {
      race: true,
      notes: [
        'Wednesday 21 April: rest. Prepare kit; familiar meals and hydration; confirm the start time.',
        'Thursday 22 April: race.',
        'Friday: recovery, walking only as comfortable.',
      ],
    },
  ),
]

export const program: Program = {
  version: 3,
  raceDay: RACE_DAY,
  weekCount: 24,
  stations,
  phases: [
    { id: 'foundation', name: 'Foundation', firstWeek: 1, lastWeek: 5, weeks: foundation },
    { id: 'build', name: 'Build', firstWeek: 6, lastWeek: 15, weeks: withSecondEasyRun(build) },
    { id: 'race-specific', name: 'Race specific', firstWeek: 16, lastWeek: 21, weeks: withSecondEasyRun(raceSpecific) },
    // Race week stays inside the Taper Phase: the two Taper Weeks, then Week 24.
    { id: 'taper', name: 'Taper', firstWeek: 22, lastWeek: 24, weeks: taper },
  ],
}
