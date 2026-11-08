/**
 * Session logs in brief, as tests and scenarios write them: the end-to-end
 * tests (e2e/history.ts) and mock mode's scenarios both start from these
 * shapes, so a history written once serves both. Types only from the domain:
 * Playwright imports this file too.
 */
import type { SessionLog } from '../../domain/log'

export interface SeedLog {
  week: number
  sessionId: string
  date: string
  status: 'done' | 'partial' | 'skipped' | 'swapped'
  minutes?: number
  rpe?: number
  /** The race's finish time in seconds. */
  resultSeconds?: number
  /** Where a run happened. */
  environment?: 'indoor' | 'outdoor'
  /** A Live run's reps: a by-feel rep logs the speed answered at the end. */
  intervals?: { block: number; rep: number; targetPace: number | null; held: boolean; actualPace: number | null }[]
  /** The recovery jogs' pace from the By-feel speeds, in seconds per km. */
  recoveryPace?: number
  /** A Strength session's sets: what the Coach reads for the Working weights. */
  sets?: { exercise: number; set: number; lift: string | null; pounds: number | null; reps: number; rpe: number }[]
  /** A HYROX session's rounds or a Race simulation's splits. */
  stations?: { round: number; part: string; pounds: number | null; meters: number | null; reps: number | null; seconds: number | null }[]
}

/**
 * A log as the server answers it: every field there, none missing, with an id
 * that is the same on every run. Unchecked: the Worker's parser checks it when it's sent.
 */
export const toLog = (seed: SeedLog, prefix: string) =>
  ({
    minutes: 45,
    rpe: seed.status === 'skipped' ? null : 6,
    resultSeconds: null,
    environment: null,
    distanceMeters: null,
    recoveryPace: null,
    intervals: [],
    stations: [],
    sets: [],
    ...seed,
    id: `${prefix}-w${seed.week}-${seed.sessionId}`,
    notes: null,
    updatedAt: `${seed.date}T20:00:00.000Z`,
  }) as unknown as SessionLog

/** Every Session of a Week but the Optional one, Done on `date`: nothing Late, nothing Skipped. */
export const weekDone = (week: number, sessionIds: string[], date: string): SeedLog[] =>
  sessionIds.map((sessionId) => ({ week, sessionId, date, status: 'done' }))

type Sets = NonNullable<SeedLog['sets']>
const sets = (exercise: number, lift: string, specs: [pounds: number, reps: number, rpe: number][]): Sets =>
  specs.map(([pounds, reps, rpe], i) => ({ exercise, set: i + 1, lift, pounds, reps, rpe }))
const station = (part: string, seconds: number | null, done: { meters?: number; pounds?: number } = {}) => ({
  round: 1,
  part,
  pounds: done.pounds ?? null,
  meters: done.meters ?? null,
  reps: null,
  seconds,
})

/**
 * The baseline Compromised run test's rounds: 4:58, 5:04, 5:09 and 5:17 for
 * the four 1 km runs, so Race run pace is their mean, 5:07/km (Threshold
 * 4:52, Easy 6:07–6:37), and the Fade is +19 s/km.
 */
export const BASELINE_SPLITS = [298, 304, 309, 317]
const TEST_STATIONS: [part: string, done: { meters?: number; reps?: number; pounds?: number }, seconds: number][] = [
  ['skierg', { meters: 500 }, 118],
  ['sled-push', { meters: 25, pounds: 335 }, 95],
  ['row', { meters: 500 }, 124],
  ['wall-balls', { reps: 50, pounds: 20 }, 170],
]
const BASELINE_TEST: NonNullable<SeedLog['stations']> = BASELINE_SPLITS.flatMap((seconds, i) => {
  const [part, done, stationSeconds] = TEST_STATIONS[i]
  return [
    { round: i + 1, part: 'run', pounds: null, meters: 1000, reps: null, seconds },
    { round: i + 1, part, pounds: done.pounds ?? null, meters: done.meters ?? null, reps: done.reps ?? null, seconds: stationSeconds },
  ]
})

/**
 * Week 1 mostly done and the baseline Compromised run test in Week 2, with
 * Week 2's Strength session on Thursday 19 November. Week 1 calibrated the
 * squat at 185 lb and the RDL at 135 lb; Week 2's easy squats moved it to
 * 190 lb, accepted (`BASELINE_DECISIONS`). The `after-baseline` scenario and
 * e2e/progress.e2e.ts both start from it.
 */
export const BASELINE_HISTORY: SeedLog[] = [
  {
    week: 1,
    sessionId: 'hyrox-a',
    date: '2026-11-09',
    status: 'done',
    minutes: 50,
    rpe: 7,
    // Round 1 timed leg by leg: the sled push at Race load, then the run.
    stations: [
      station('round', 330),
      station('sled-push', 190, { meters: 25, pounds: 335 }),
      station('run', 140, { meters: 400 }),
    ],
  },
  {
    week: 1,
    sessionId: 'strength',
    date: '2026-11-10',
    status: 'done',
    sets: [...sets(0, 'back-squat', [[165, 5, 6], [185, 5, 7]]), ...sets(1, 'romanian-deadlift', [[135, 6, 7]])],
  },
  { week: 1, sessionId: 'run', date: '2026-11-12', status: 'partial' },
  { week: 1, sessionId: 'hyrox-b', date: '2026-11-14', status: 'done', rpe: 7 },
  {
    week: 2,
    sessionId: 'compromised-run-test',
    date: '2026-11-18',
    status: 'done',
    rpe: 9,
    environment: 'indoor',
    stations: BASELINE_TEST,
  },
  {
    week: 2,
    sessionId: 'strength',
    date: '2026-11-19',
    status: 'done',
    sets: [
      ...sets(0, 'back-squat', [[185, 5, 7], [185, 5, 7], [185, 5, 7]]),
      ...sets(1, 'romanian-deadlift', [[135, 6, 8], [135, 6, 8], [135, 6, 8]]),
    ],
  },
]

/** The squat's move to 190 lb after Week 2, accepted. */
export const BASELINE_DECISIONS = [
  { id: 'ww-back-squat-w2', decision: 'accepted', date: '2026-11-19', updatedAt: '2026-11-19T21:00:00.000Z' },
]
