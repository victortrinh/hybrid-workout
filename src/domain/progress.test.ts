import { describe, expect, it } from 'vitest'
import { localDate } from './calendar'
import type { LoggedStatus, SessionLog } from './log'
import type { Environment } from './paces'
import { program } from './program/program'
import {
  finalTestWeek,
  fiveKProgress,
  GOAL_SECONDS,
  plannedAt,
  trainingLoad,
  weekOf,
  weeklyCompletion,
} from './progress'

let n = 0
function log(
  week: number,
  sessionId: string,
  date: string,
  extra: Partial<Pick<SessionLog, 'status' | 'minutes' | 'rpe' | 'resultSeconds' | 'environment' | 'updatedAt'>> = {},
): SessionLog {
  n += 1
  return {
    id: `log-${String(n).padStart(4, '0')}`,
    week,
    sessionId,
    date: localDate(date),
    status: 'done' as LoggedStatus,
    minutes: 45,
    rpe: 6,
    notes: null,
    resultSeconds: null,
    environment: null,
    distanceMeters: null,
    intervals: [],
    updatedAt: `${date}T20:00:00.000Z`,
    ...extra,
  }
}

const test5k = (week: number, date: string, seconds: number, environment: Environment = 'indoor') =>
  log(week, '5k-test', date, { resultSeconds: seconds, environment, minutes: 45, rpe: 9 })

describe('the 5K series', () => {
  it('has no tests and no planned line before the baseline', () => {
    const fiveK = fiveKProgress(program, [], localDate('2026-11-04'))
    expect(fiveK.tests).toEqual([])
    expect(fiveK.planned).toBeNull()
    expect(fiveK.upcoming.map((u) => u.week)).toEqual([9, 17, 25])
    expect(fiveK.upcoming.every((u) => u.seconds === null)).toBe(true)
  })

  it('runs the planned line from the baseline to 20:00 by Week 25', () => {
    const fiveK = fiveKProgress(program, [test5k(2, '2026-10-28', 23 * 60)], localDate('2026-11-04'))
    expect(finalTestWeek(program)).toBe(25)
    expect(fiveK.tests).toEqual([{ week: 2, date: '2026-10-28', seconds: 1380, environment: 'indoor' }])
    expect(fiveK.planned).toEqual({ from: { week: 2, seconds: 1380 }, to: { week: 25, seconds: GOAL_SECONDS } })
    expect(GOAL_SECONDS).toBe(1200)
    // 180 s over 23 Weeks.
    expect(fiveK.upcoming).toEqual([
      { week: 9, seconds: Math.round(1380 - (7 / 23) * 180) },
      { week: 17, seconds: Math.round(1380 - (15 / 23) * 180) },
      { week: 25, seconds: 1200 },
    ])
  })

  it('keeps every test, oldest first, with where it was run; the line stays anchored on the baseline', () => {
    const logs = [test5k(9, '2026-12-16', 22 * 60 + 10, 'outdoor'), test5k(2, '2026-10-28', 23 * 60)]
    const fiveK = fiveKProgress(program, logs, localDate('2027-01-06'))
    expect(fiveK.tests.map((t) => [t.week, t.seconds, t.environment])).toEqual([
      [2, 1380, 'indoor'],
      [9, 1330, 'outdoor'],
    ])
    expect(fiveK.planned?.from).toEqual({ week: 2, seconds: 1380 })
    expect(fiveK.upcoming.map((u) => u.week)).toEqual([17, 25])
  })

  it('ignores a test without a time, one not Done, and a later edit decides', () => {
    const logs = [
      log(2, '5k-test', '2026-10-28'),
      test5k(9, '2026-12-16', 1300),
      log(9, '5k-test', '2026-12-16', { status: 'skipped', updatedAt: '2026-12-17T10:00:00.000Z' }),
    ]
    expect(fiveKProgress(program, logs, localDate('2027-01-06')).tests).toEqual([])
  })

  it('drops a 5K test Week from upcoming once it has passed untested', () => {
    const fiveK = fiveKProgress(program, [], localDate('2026-11-02'))
    expect(fiveK.upcoming.map((u) => u.week)).toEqual([9, 17, 25])
    expect(fiveKProgress(program, [], localDate('2026-10-28')).upcoming.map((u) => u.week)).toEqual([2, 9, 17, 25])
  })

  it('places a Week on the line', () => {
    const line = { from: { week: 2, seconds: 1380 }, to: { week: 25, seconds: 1200 } }
    expect(plannedAt(line, 2)).toBe(1380)
    expect(plannedAt(line, 25)).toBe(1200)
    expect(plannedAt(line, 13.5)).toBe(1290)
  })
})

describe('weekly completion', () => {
  it('lists Weeks 1 to today’s, each Session in Bucket order', () => {
    const logs = [
      log(1, 'speed', '2026-10-19'),
      log(1, 'strength', '2026-10-20', { status: 'partial' }),
      log(1, 'threshold', '2026-10-22', { status: 'skipped' }),
    ]
    const weeks = weeklyCompletion(program, logs, localDate('2026-11-04'))
    expect(weeks.map((w) => w.week)).toEqual([1, 2, 3])

    const [one, two, three] = weeks
    expect(one.cells.map((c) => [c.session.type, c.state])).toEqual([
      ['speed', 'done'],
      ['strength', 'partial'],
      ['threshold', 'skipped'],
      ['hyrox', 'missed'],
      // The Optional session is never a miss.
      ['easy', 'open'],
    ])
    expect(one).toMatchObject({ done: 2, required: 4 })
    // Week 2's Key session (the 5K test) carries until Wednesday of Week 3, and today is Wednesday.
    expect(two.cells.find((c) => c.session.type === '5k-test')?.state).toBe('open')
    expect(two.cells.filter((c) => c.state === 'missed').map((c) => c.session.type)).toEqual([
      'strength',
      'threshold',
      'hyrox',
    ])
    expect(three.cells.every((c) => c.state === 'open')).toBe(true)
  })

  it('is empty before Week 1 and stops at the last Week after the Program', () => {
    expect(weeklyCompletion(program, [], localDate('2026-10-13'))).toEqual([])
    expect(weeklyCompletion(program, [], localDate('2027-06-01')).at(-1)?.week).toBe(program.weekCount)
  })
})

describe('Training load', () => {
  it('sums RPE × minutes per Week, by lane', () => {
    const logs = [
      log(1, 'speed', '2026-10-19', { rpe: 7, minutes: 45 }),
      log(1, 'strength', '2026-10-20', { rpe: 6, minutes: 45 }),
      log(1, 'easy', '2026-10-24', { rpe: 3, minutes: 20 }),
      test5k(2, '2026-10-28', 1380),
      log(2, 'hyrox', '2026-10-30', { rpe: 7, minutes: 60, status: 'partial' }),
    ]
    const load = trainingLoad(program, logs, localDate('2026-11-04'))
    expect(load).toEqual([
      { week: 1, byLane: { speed: 315, strength: 270, easy: 60 }, total: 645 },
      // The 5K test runs in the Speed lane.
      { week: 2, byLane: { speed: 405, hyrox: 420 }, total: 825 },
      { week: 3, byLane: {}, total: 0 },
    ])
  })

  it('counts a carried Key session in the Week it was done', () => {
    const load = trainingLoad(program, [test5k(2, '2026-11-03', 1380)], localDate('2026-11-04'))
    expect(load.map((w) => w.total)).toEqual([0, 0, 405])
  })

  it('leaves out Skipped and Swapped Sessions, logs without RPE or minutes, and older edits', () => {
    const logs = [
      log(1, 'speed', '2026-10-19', { status: 'skipped' }),
      log(1, 'strength', '2026-10-20', { status: 'swapped' }),
      log(1, 'threshold', '2026-10-21', { rpe: null }),
      log(1, 'hyrox', '2026-10-22', { minutes: null }),
      log(1, 'easy', '2026-10-23', { rpe: 9, minutes: 60, updatedAt: '2026-10-23T08:00:00.000Z' }),
      log(1, 'easy', '2026-10-23', { rpe: 3, minutes: 20, updatedAt: '2026-10-23T21:00:00.000Z' }),
    ]
    expect(trainingLoad(program, logs, localDate('2026-10-25'))).toEqual([
      { week: 1, byLane: { easy: 60 }, total: 60 },
    ])
  })

  it('places dates in Program Weeks', () => {
    expect(weekOf(program, localDate('2026-10-18'))).toBeNull()
    expect(weekOf(program, localDate('2026-10-19'))).toBe(1)
    expect(weekOf(program, localDate('2026-10-25'))).toBe(1)
    expect(weekOf(program, localDate('2026-10-26'))).toBe(2)
    expect(weekOf(program, localDate('2027-04-21'))).toBe(27)
    expect(weekOf(program, localDate('2027-04-26'))).toBeNull()
  })
})
