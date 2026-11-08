import { describe, expect, it } from 'vitest'
import { localDate } from './calendar'
import type { SessionLog, SetLog, StationLog } from './log'
import { logSummary } from './logSummary'
import type { SessionType } from './program/types'

const log = (overrides: Partial<SessionLog> = {}): SessionLog => ({
  id: 'log-00000001',
  week: 2,
  sessionId: 'run',
  date: localDate('2026-11-04'),
  status: 'done',
  minutes: null,
  rpe: null,
  notes: null,
  resultSeconds: null,
  environment: null,
  distanceMeters: null,
  recoveryPace: null,
  intervals: [],
  sets: [],
  stations: [],
  updatedAt: '2026-11-04T17:00:00.000Z',
  ...overrides,
})

const set = (exercise: number, lift: SetLog['lift'], pounds: number | null, reps: number): SetLog => ({
  exercise,
  set: 1,
  lift,
  pounds,
  reps,
  rpe: 7,
})

const station = (round: number, part: StationLog['part'], seconds: number | null): StationLog => ({
  round,
  part,
  pounds: null,
  meters: null,
  reps: null,
  seconds,
})

const summary = (type: SessionType, overrides: Partial<SessionLog>) => logSummary(log(overrides), type)

describe('logSummary', () => {
  it('gives each lift its top set: the heaviest, then the most reps', () => {
    const sets = [
      set(0, 'back-squat', 165, 5),
      set(0, 'back-squat', 185, 5),
      set(0, 'back-squat', 185, 4),
      set(1, 'romanian-deadlift', 135, 6),
      set(5, null, null, 8),
    ]
    expect(summary('strength', { sets, rpe: 7 })).toBe('Squat 185 lb × 5, RDL 135 lb × 6 · RPE 7')
  })

  it('lists a HYROX session’s round times', () => {
    const stations = [station(1, 'round', 540), station(1, 'run', null), station(2, 'round', 525)]
    expect(summary('hyrox', { stations })).toBe('Rounds 9:00, 8:45')
    expect(summary('hyrox', { stations: [station(1, 'round', 540)] })).toBe('Round 9:00')
  })

  it('totals a Race simulation’s splits', () => {
    const stations = [station(1, 'run', 285), station(1, 'skierg', 260), station(2, 'run', 3300)]
    expect(summary('race-simulation', { stations, rpe: 8 })).toBe('Race simulation, 1:04:05 · RPE 8')
  })

  it('gives a Compromised run test its Race run pace and its Fade, first split to fourth', () => {
    const run = (round: number, seconds: number | null): StationLog => ({ ...station(round, 'run', seconds), meters: 1000 })
    const stations = [run(1, 290), station(1, 'skierg', 120), run(2, 300), run(3, 305), run(4, 313)]
    const test = { sessionId: 'compromised-run-test', stations, minutes: 45, rpe: 9 }
    expect(summary('compromised-run-test', test)).toBe('Race run pace 5:02/km · Fade +23 s/km · 45 min · RPE 9')
    const negative = [run(1, 300), run(2, 298), run(3, 296), run(4, 294)]
    expect(summary('compromised-run-test', { ...test, stations: negative })).toBe('Race run pace 4:57/km · Fade −6 s/km · 45 min · RPE 9')
    // Cut short: no Race run pace from it, but the Fade of what was run.
    expect(summary('compromised-run-test', { ...test, status: 'partial', stations: stations.slice(0, 3) })).toBe(
      'Fade +10 s/km · 45 min · RPE 9',
    )
  })

  it('counts the reps held on target in a Live run', () => {
    const intervals = [
      { block: 1, rep: 1, targetPace: 292, held: true, actualPace: null },
      { block: 3, rep: 2, targetPace: 292, held: false, actualPace: 300 },
    ]
    expect(summary('run', { intervals, minutes: 50, rpe: 8 })).toBe('1 of 2 reps on target · 50 min · RPE 8')
    const byRpe = intervals.map((i) => ({ ...i, targetPace: null }))
    expect(summary('run', { intervals: byRpe, rpe: 8 })).toBe('RPE 8')
  })

  it('falls back to time and RPE, and says nothing for a log with neither', () => {
    expect(summary('easy', { minutes: 40, rpe: 4 })).toBe('40 min · RPE 4')
    expect(summary('easy', {})).toBeNull()
  })

  it('says nothing about a Skipped or Swapped Session: what was done was something else', () => {
    expect(summary('easy', { status: 'swapped', minutes: 45, rpe: 5 })).toBeNull()
    expect(summary('compromised-run-test', { status: 'skipped', rpe: 3 })).toBeNull()
  })

  it('summarises a Partial Session from what it got through', () => {
    expect(
      summary('strength', {
        status: 'partial',
        sets: [set(0, 'back-squat', 185, 5)],
      }),
    ).toBe('Squat 185 lb × 5')
  })
})
