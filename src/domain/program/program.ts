/**
 * The approved Program (docs/training-plan.md, approved 13 Oct 2026) as data.
 *
 * Weeks 1–3 are encoded so far; the remaining Weeks arrive with the Plan
 * screen. Phase ranges cover all 27 Weeks already, so Today can place any date.
 */
import { localDate } from '../calendar'
import type {
  Exercise,
  LiftId,
  Program,
  Session,
  Station,
  StationId,
  StrengthLoad,
  Substitution,
  Week,
} from './types'

// ---------------------------------------------------------------------------
// Race loads: Men's Open 2025/26, in pounds. Verify on hyrox.com before race day.

const stations: Record<StationId, Station> = {
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

// ---------------------------------------------------------------------------
// Building blocks shared by the Session templates.

const EASY_RPE = [2, 4] as const
const THRESHOLD_RPE = [6, 7] as const

const easyJog = (minutes: number, name = 'Easy jog'): Exercise => ({
  name,
  prescription: { kind: 'run', minutes, effort: { pace: 'easy', rpe: EASY_RPE } },
})

/** No floor space, or Readiness says no jumps: sprint on the sled or the bike instead. */
const floorSubstitution: Substitution = {
  when: ['no-floor-space', 'readiness'],
  options: [
    { name: 'Sled push sprints', prescription: { kind: 'sprints', meters: [10, 15], light: true } },
    { name: 'Bike sprints', prescription: { kind: 'sprints', seconds: [8, 10] } },
  ],
}

function speed(
  intervals: { reps: number; workSeconds: number; recoverySeconds: number },
  accelerations: number,
): Session {
  return {
    id: 'speed',
    type: 'speed',
    headline: `${intervals.reps} × ${intervals.workSeconds / 60}′`,
    minutes: 45,
    key: false,
    optional: false,
    blocks: [
      {
        name: 'Warm-up',
        minutes: 10,
        exercises: [easyJog(10), { name: 'Leg swings, skips, drills', prescription: { kind: 'note' } }],
      },
      {
        name: 'Plyometrics',
        minutes: 5,
        exercises: [
          {
            name: 'Pogo jumps',
            prescription: { kind: 'sets', sets: 2, reps: 15, load: { kind: 'bodyweight' } },
            note: 'Ground contacts',
            substitutions: [floorSubstitution],
          },
          {
            name: 'Broad jumps',
            prescription: { kind: 'sets', sets: 3, reps: 3, load: { kind: 'bodyweight' } },
            note: 'Full reset between jumps',
            substitutions: [floorSubstitution],
          },
        ],
      },
      {
        name: 'Accelerations',
        minutes: 5,
        exercises: [
          {
            name: 'Accelerations',
            prescription: { kind: 'accelerations', reps: accelerations, meters: 15, percentOfMax: [80, 90] },
            note: 'Walk back. Never maximal this early.',
            substitutions: [floorSubstitution],
          },
        ],
      },
      {
        name: 'Intervals',
        minutes: 20,
        main: true,
        exercises: [
          {
            name: 'Intervals',
            prescription: { kind: 'intervals', ...intervals, recovery: 'jog', effort: { feel: 'hard' } },
          },
        ],
      },
      { name: 'Cooldown', minutes: 5, exercises: [easyJog(5, 'Jog or walk')] },
    ],
  }
}

const fiveKTest: Session = {
  id: '5k-test',
  type: '5k-test',
  headline: 'baseline',
  minutes: 45,
  key: true,
  optional: false,
  blocks: [
    {
      name: 'Warm-up',
      minutes: 12,
      exercises: [easyJog(12), { name: 'Strides', prescription: { kind: 'strides', reps: 4, seconds: 15 } }],
    },
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

function threshold(reps: number, repMinutes: number, key: boolean): Session {
  const work = reps * repMinutes + (reps - 1) * 2
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
              recoverySeconds: 120,
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

function strength(calibration: boolean): Session {
  const load = (lift: LiftId): StrengthLoad =>
    calibration ? { kind: 'find-working-weight', lift, rpe: 7 } : { kind: 'working-weight', lift }
  const rpe7 = calibration ? undefined : ([7, 7] as const)
  return {
    id: 'strength',
    type: 'strength',
    headline: calibration ? 'find Working weights' : 'squat 3 × 5',
    minutes: 45,
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
            prescription: { kind: 'sets', sets: 3, reps: 5, load: load('back-squat'), rpe: rpe7, restSeconds: [90, 120] },
          },
          {
            name: 'Romanian deadlift',
            prescription: { kind: 'sets', sets: 3, reps: 6, load: load('romanian-deadlift'), rpe: rpe7 },
            note: 'Slow lowering',
          },
        ],
      },
      {
        name: 'Unilateral',
        exercises: [
          {
            name: 'Bulgarian split squat',
            prescription: { kind: 'sets', sets: 2, reps: 6, perLeg: true, load: load('bulgarian-split-squat'), rpe: rpe7 },
          },
        ],
      },
      {
        name: 'Tendon',
        exercises: [
          {
            name: 'Single-leg calf raise',
            prescription: { kind: 'sets', sets: 3, reps: 8, perLeg: true, load: load('single-leg-calf-raise') },
            note: 'Off a step, dumbbell in hand, 2–3 s lowering',
          },
          {
            name: 'Seated calf raise',
            prescription: { kind: 'sets', sets: 2, reps: 10, load: load('seated-calf-raise') },
            note: 'Dumbbell or barbell on the knees',
          },
        ],
      },
      {
        name: 'Upper',
        exercises: [
          {
            name: 'Pull-ups and push-ups',
            prescription: { kind: 'sets', sets: 2, reps: [6, 10], load: { kind: 'bodyweight' } },
            note: 'Superset, each',
          },
        ],
      },
    ],
  }
}

type Rotation = 'A' | 'B'

/** Foundation Station volumes per round, at about 60% of Race load. */
const FOUNDATION_ROUNDS: Record<Rotation, Exercise[][]> = {
  A: [
    [station('sled-push', { meters: 25 }), station('sled-pull', { meters: 25 })],
    [station('farmers-carry', { meters: 50 }), station('sandbag-lunges', { meters: 25 })],
    [station('sled-push', { meters: 25 }), station('sled-pull', { meters: 25 })],
  ],
  B: [
    [station('skierg', { meters: 250 }), station('burpee-broad-jumps', { meters: 10 })],
    [station('row', { meters: 250 }), station('wall-balls', { reps: 20 })],
    [station('skierg', { meters: 250 }), station('burpee-broad-jumps', { meters: 10 })],
  ],
}

function station(id: StationId, volume: { meters?: number; reps?: number }): Exercise {
  const scales = stations[id].raceLoad.pounds !== undefined && !stations[id].raceLoad.fixedLoad
  return {
    name: stations[id].name,
    prescription: { kind: 'station', station: id, ...volume, raceLoadPercent: scales ? 60 : undefined },
  }
}

function hyrox(rotation: Rotation): Session {
  return {
    id: 'hyrox',
    type: 'hyrox',
    headline: '3 rounds',
    minutes: 45,
    key: false,
    optional: false,
    blocks: [
      {
        name: 'Warm-up',
        minutes: 7,
        exercises: [
          easyJog(7),
          { name: 'Lunges and Station prep', prescription: { kind: 'note' }, note: 'Check the sled and erg setup.' },
        ],
      },
      ...FOUNDATION_ROUNDS[rotation].map((stationsInRound, i) => ({
        name: `Round ${i + 1}`,
        minutes: 11,
        main: true,
        exercises: [{ name: 'Run', prescription: { kind: 'run' as const, meters: 600 } }, ...stationsInRound],
      })),
      {
        name: 'Cooldown',
        minutes: 5,
        exercises: [{ name: 'Walk, relaxed breathing', prescription: { kind: 'note', minutes: 5 }, note: 'No extra finisher.' }],
      },
    ],
  }
}

function easyRun(minutes: number): Session {
  return {
    id: 'easy',
    type: 'easy',
    headline: `${minutes}′`,
    minutes,
    key: false,
    optional: true,
    blocks: [
      {
        name: 'Easy run',
        minutes,
        main: true,
        exercises: [{ ...easyJog(minutes, 'Easy run'), note: 'Full sentences. No tempo, no hills.' }],
      },
    ],
  }
}

// ---------------------------------------------------------------------------
// Week by week.

const week = (
  number: number,
  startDate: string,
  sessions: Session[],
  flags: Partial<Pick<Week, 'deload' | 'fiveKTest' | 'raceSimulation'>> = {},
): Week => ({
  number,
  startDate: localDate(startDate),
  deload: false,
  fiveKTest: false,
  raceSimulation: false,
  ...flags,
  sessions,
})

const foundation: Week[] = [
  week(1, '2026-10-19', [
    speed({ reps: 5, workSeconds: 120, recoverySeconds: 120 }, 2),
    strength(true),
    threshold(3, 7, true),
    hyrox('A'),
    easyRun(20),
  ]),
  week(2, '2026-10-26', [fiveKTest, strength(false), threshold(3, 7, false), hyrox('B'), easyRun(20)], {
    fiveKTest: true,
  }),
  week(3, '2026-11-02', [
    speed({ reps: 5, workSeconds: 180, recoverySeconds: 90 }, 4),
    strength(false),
    threshold(2, 12, true),
    hyrox('A'),
    easyRun(25),
  ]),
]

export const program: Program = {
  version: 1,
  raceDay: localDate('2027-04-21'),
  weekCount: 27,
  stations,
  phases: [
    { id: 'foundation', name: 'Foundation', firstWeek: 1, lastWeek: 6, weeks: foundation },
    { id: '5k-development', name: '5K development', firstWeek: 7, lastWeek: 14, weeks: [] },
    { id: 'hyrox-build', name: 'HYROX build', firstWeek: 15, lastWeek: 22, weeks: [] },
    { id: 'race-specific', name: 'Race specific', firstWeek: 23, lastWeek: 25, weeks: [] },
    { id: 'taper', name: 'Taper', firstWeek: 26, lastWeek: 27, weeks: [] },
  ],
}
