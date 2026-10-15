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
  /** A 5K test's time in seconds, and where it was run. */
  resultSeconds?: number
  environment?: 'indoor' | 'outdoor'
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
    intervals: [],
    stations: [],
    sets: [],
    ...seed,
    id: `${prefix}-w${seed.week}-${seed.sessionId}`,
    notes: null,
    updatedAt: `${seed.date}T20:00:00.000Z`,
  }) as unknown as SessionLog

/** Every Session of a Week but the Optional one, Done on `date`: nothing carried, nothing Skipped. */
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
 * Week 1 mostly done and a 23:00 treadmill baseline in Week 2, with Week 2's
 * Strength session on Thursday 29 October. Week 1 calibrated the squat at
 * 185 lb and the RDL at 135 lb; Week 2's easy squats moved it to 190 lb,
 * accepted (`BASELINE_DECISIONS`). The `after-baseline` scenario and
 * e2e/progress.e2e.ts both start from it.
 */
export const BASELINE_HISTORY: SeedLog[] = [
  { week: 1, sessionId: 'speed', date: '2026-10-19', status: 'done', rpe: 7 },
  {
    week: 1,
    sessionId: 'strength',
    date: '2026-10-20',
    status: 'done',
    sets: [...sets(0, 'back-squat', [[165, 5, 6], [185, 5, 7]]), ...sets(1, 'romanian-deadlift', [[135, 6, 7]])],
  },
  { week: 1, sessionId: 'threshold', date: '2026-10-22', status: 'partial' },
  {
    week: 1,
    sessionId: 'hyrox',
    date: '2026-10-24',
    status: 'done',
    minutes: 60,
    rpe: 7,
    // Round 1 timed leg by leg: the run, then each sled.
    stations: [
      station('round', 600),
      station('run', 200, { meters: 600 }),
      station('sled-push', 190, { meters: 25, pounds: 200 }),
      station('sled-pull', 210, { meters: 25, pounds: 135 }),
    ],
  },
  { week: 2, sessionId: '5k-test', date: '2026-10-28', status: 'done', rpe: 9, resultSeconds: 1380, environment: 'indoor' },
  {
    week: 2,
    sessionId: 'strength',
    date: '2026-10-29',
    status: 'done',
    sets: [
      ...sets(0, 'back-squat', [[185, 5, 7], [185, 5, 7], [185, 5, 7]]),
      ...sets(1, 'romanian-deadlift', [[135, 6, 8], [135, 6, 8], [135, 6, 8]]),
    ],
  },
]

/** The squat's move to 190 lb after Week 2, accepted. */
export const BASELINE_DECISIONS = [
  { id: 'ww-back-squat-w2', decision: 'accepted', date: '2026-10-29', updatedAt: '2026-10-29T21:00:00.000Z' },
]
