import { describe, expect, it } from 'vitest'
import { localDate } from './calendar'
import type { LoggedStatus, SessionLog, StationLog } from './log'
import type { Environment } from './paces'
import { program } from './program/program'
import {
  finalTestWeek,
  fiveKProgress,
  GOAL_SECONDS,
  plannedAt,
  recoveryTrend,
  stationTimes,
  trainingLoad,
  weekOf,
  weeklyCompletion,
  workingWeightRows,
} from './progress'
import type { RecoveryNight } from './recovery'
import type { WorkingWeightChange } from './weights'

let n = 0
function log(
  week: number,
  sessionId: string,
  date: string,
  extra: Partial<Pick<SessionLog, 'status' | 'minutes' | 'rpe' | 'resultSeconds' | 'environment' | 'stations' | 'updatedAt'>> = {},
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
    recoveryPace: null,
    intervals: [],
    sets: [],
    stations: [],
    updatedAt: `${date}T20:00:00.000Z`,
    ...extra,
  }
}

/** A Compromised run test logged with a result time: the series still reads one, until it reads the splits. */
const test = (week: number, date: string, seconds: number, environment: Environment = 'indoor') =>
  log(week, 'compromised-run-test', date, { resultSeconds: seconds, environment, minutes: 45, rpe: 9 })

describe('the test series', () => {
  it('has no tests and no planned line before the baseline', () => {
    const series = fiveKProgress(program, [], localDate('2026-11-11'))
    expect(series.tests).toEqual([])
    expect(series.planned).toBeNull()
    expect(series.upcoming.map((u) => u.week)).toEqual([2, 9, 14, 19])
    expect(series.upcoming.every((u) => u.seconds === null)).toBe(true)
  })

  it('runs the planned line from the baseline to the last test Week, Week 19', () => {
    const series = fiveKProgress(program, [test(2, '2026-11-18', 23 * 60)], localDate('2026-11-25'))
    expect(finalTestWeek(program)).toBe(19)
    expect(series.tests).toEqual([{ week: 2, date: '2026-11-18', seconds: 1380, environment: 'indoor' }])
    expect(series.planned).toEqual({ from: { week: 2, seconds: 1380 }, to: { week: 19, seconds: GOAL_SECONDS } })
    // 60 s over 17 Weeks.
    expect(series.upcoming).toEqual([
      { week: 9, seconds: Math.round(1380 - (7 / 17) * 60) },
      { week: 14, seconds: Math.round(1380 - (12 / 17) * 60) },
      { week: 19, seconds: GOAL_SECONDS },
    ])
  })

  it('keeps every test, oldest first, with where it was run; the line stays anchored on the baseline', () => {
    const logs = [test(9, '2027-01-06', 22 * 60 + 10, 'outdoor'), test(2, '2026-11-18', 23 * 60)]
    const series = fiveKProgress(program, logs, localDate('2027-01-20'))
    expect(series.tests.map((t) => [t.week, t.seconds, t.environment])).toEqual([
      [2, 1380, 'indoor'],
      [9, 1330, 'outdoor'],
    ])
    expect(series.planned?.from).toEqual({ week: 2, seconds: 1380 })
    expect(series.upcoming.map((u) => u.week)).toEqual([14, 19])
  })

  it('ignores a test without a time, one not Done, and a later edit decides', () => {
    const logs = [
      log(2, 'compromised-run-test', '2026-11-18'),
      test(9, '2027-01-06', 1300),
      log(9, 'compromised-run-test', '2027-01-06', { status: 'skipped', updatedAt: '2027-01-07T10:00:00.000Z' }),
    ]
    expect(fiveKProgress(program, logs, localDate('2027-01-20')).tests).toEqual([])
  })

  it('drops a test Week from upcoming once it has passed untested', () => {
    expect(fiveKProgress(program, [], localDate('2026-11-23')).upcoming.map((u) => u.week)).toEqual([9, 14, 19])
    expect(fiveKProgress(program, [], localDate('2026-11-18')).upcoming.map((u) => u.week)).toEqual([2, 9, 14, 19])
  })

  it('places a Week on the line', () => {
    const line = { from: { week: 2, seconds: 1380 }, to: { week: 24, seconds: 1200 } }
    expect(plannedAt(line, 2)).toBe(1380)
    expect(plannedAt(line, 24)).toBe(1200)
    expect(plannedAt(line, 13)).toBe(1290)
  })
})

describe('weekly completion', () => {
  it('lists Weeks 1 to today’s, each Session in Bucket order', () => {
    const logs = [
      log(1, 'hyrox-a', '2026-11-09'),
      log(1, 'strength', '2026-11-10', { status: 'partial' }),
      log(1, 'run', '2026-11-12', { status: 'skipped' }),
    ]
    const weeks = weeklyCompletion(program, logs, localDate('2026-11-25'))
    expect(weeks.map((w) => w.week)).toEqual([1, 2, 3])

    const [one, two, three] = weeks
    expect(one.cells.map((c) => [c.session.id, c.state])).toEqual([
      ['hyrox-a', 'done'],
      // Never logged, it is a Late session (ADR-0007): still open, not missed.
      ['hyrox-b', 'open'],
      ['run', 'skipped'],
      ['strength', 'partial'],
      // The Optional session is never a miss.
      ['easy', 'open'],
    ])
    expect(one).toMatchObject({ done: 2, required: 4, missed: 1 })
    expect(two.cells.every((c) => c.state === 'open')).toBe(true)
    expect(two).toMatchObject({ done: 0, missed: 0 })
    expect(three.cells.every((c) => c.state === 'open')).toBe(true)
    expect(three).toMatchObject({ done: 0, missed: 0 })
  })

  it('agrees with Today: a Skipped Session is still open while its Week has days left', () => {
    const logs = [
      log(3, 'hyrox-a', '2026-11-23'),
      log(3, 'strength', '2026-11-24', { status: 'partial' }),
      log(3, 'hyrox-b', '2026-11-25', { status: 'skipped' }),
      log(3, 'easy', '2026-11-25', { status: 'swapped' }),
      log(3, 'run', '2026-11-26'),
    ]
    const during = weeklyCompletion(program, logs, localDate('2026-11-26')).at(-1)!
    expect(during.cells.find((c) => c.session.id === 'hyrox-b')?.state).toBe('open')
    expect(during).toMatchObject({ done: 3, required: 4, missed: 0 })

    const after = weeklyCompletion(program, logs, localDate('2026-11-30')).find((w) => w.week === 3)!
    expect(after.cells.find((c) => c.session.id === 'hyrox-b')?.state).toBe('skipped')
    expect(after).toMatchObject({ done: 3, missed: 1 })
  })

  it('never counts the Optional session Skipped as a miss', () => {
    const logs = [log(1, 'easy', '2026-11-10', { status: 'skipped' })]
    const one = weeklyCompletion(program, logs, localDate('2026-11-25'))[0]
    expect(one.cells.find((c) => c.session.id === 'easy')?.state).toBe('skipped')
    expect(one.missed).toBe(0)
  })

  it('shows the second Easy run only in a Week it was offered, and never as a miss', () => {
    const week6 = ['hyrox-a', 'hyrox-b', 'run', 'strength'].map((id, i) => log(6, id, `2026-12-1${4 + i}`))
    const ids = (week: number, logs: SessionLog[]) =>
      weeklyCompletion(program, logs, localDate('2026-12-29')).find((w) => w.week === week)!.cells.map((c) => c.session.id)
    expect(ids(7, week6)).toEqual(['hyrox-a', 'hyrox-b', 'run', 'strength', 'easy', 'easy-2'])
    expect(ids(7, week6.slice(1))).toEqual(['hyrox-a', 'hyrox-b', 'run', 'strength', 'easy'])
    const seven = weeklyCompletion(program, week6, localDate('2026-12-29')).find((w) => w.week === 7)!
    expect(seven).toMatchObject({ required: 4, missed: 0 })
  })

  it('is empty before Week 1 and stops at the last Week after the Program', () => {
    expect(weeklyCompletion(program, [], localDate('2026-11-01'))).toEqual([])
    expect(weeklyCompletion(program, [], localDate('2027-06-01')).at(-1)?.week).toBe(program.weekCount)
  })
})

describe('Training load', () => {
  it('sums RPE × minutes per Week, by lane', () => {
    const logs = [
      log(1, 'hyrox-a', '2026-11-09', { rpe: 7, minutes: 45 }),
      log(1, 'strength', '2026-11-10', { rpe: 6, minutes: 45 }),
      log(1, 'easy', '2026-11-14', { rpe: 3, minutes: 20 }),
      test(2, '2026-11-18', 1380),
      log(2, 'hyrox-b', '2026-11-20', { rpe: 7, minutes: 60, status: 'partial' }),
    ]
    const load = trainingLoad(program, logs, localDate('2026-11-25'))
    expect(load).toEqual([
      { week: 1, byLane: { hyrox: 315, strength: 270, easy: 60 }, total: 645 },
      // The Compromised run test runs in a lane of its own.
      { week: 2, byLane: { test: 405, hyrox: 420 }, total: 825 },
      { week: 3, byLane: {}, total: 0 },
    ])
  })

  it('counts a Late session in the Week it was done', () => {
    const load = trainingLoad(program, [test(2, '2026-11-24', 1380)], localDate('2026-11-25'))
    expect(load.map((w) => w.total)).toEqual([0, 0, 405])
  })

  it('leaves out Skipped and Swapped Sessions, logs without RPE or minutes, and older edits', () => {
    const logs = [
      log(1, 'hyrox-a', '2026-11-09', { status: 'skipped' }),
      log(1, 'strength', '2026-11-10', { status: 'swapped' }),
      log(1, 'run', '2026-11-11', { rpe: null }),
      log(1, 'hyrox-b', '2026-11-12', { minutes: null }),
      log(1, 'easy', '2026-11-13', { rpe: 9, minutes: 60, updatedAt: '2026-11-13T08:00:00.000Z' }),
      log(1, 'easy', '2026-11-13', { rpe: 3, minutes: 20, updatedAt: '2026-11-13T21:00:00.000Z' }),
    ]
    expect(trainingLoad(program, logs, localDate('2026-11-15'))).toEqual([{ week: 1, byLane: { easy: 60 }, total: 60 }])
  })

  it('places dates in Program Weeks', () => {
    expect(weekOf(program, localDate('2026-11-08'))).toBeNull()
    expect(weekOf(program, localDate('2026-11-09'))).toBe(1)
    expect(weekOf(program, localDate('2026-11-15'))).toBe(1)
    expect(weekOf(program, localDate('2026-11-16'))).toBe(2)
    expect(weekOf(program, localDate('2027-04-22'))).toBe(24)
    expect(weekOf(program, localDate('2027-04-26'))).toBeNull()
  })
})

describe('Working weights', () => {
  const change = (lift: WorkingWeightChange['lift'], week: number, pounds: number, reason: WorkingWeightChange['reason']) =>
    ({ lift, week, date: localDate('2026-11-11'), pounds, reason }) as WorkingWeightChange

  it('has a row per calibrated lift, in Program order: first value, current value and the last change', () => {
    const rows = workingWeightRows([
      change('romanian-deadlift', 1, 135, 'calibration'),
      change('back-squat', 1, 185, 'calibration'),
      change('back-squat', 2, 190, 'all-reps-easy'),
      change('back-squat', 4, 180, 'two-holds'),
    ])
    expect(rows.map((r) => [r.lift, r.first.pounds, r.current, r.last.reason, r.last.week, r.before])).toEqual([
      ['back-squat', 185, 180, 'two-holds', 4, 190],
      ['romanian-deadlift', 135, 135, 'calibration', 1, null],
    ])
  })

  it('is empty before any calibration', () => {
    expect(workingWeightRows([])).toEqual([])
  })
})

describe('recovery trend', () => {
  const night = (date: string, sleepMinutes: number, hrvMs: number | null): RecoveryNight => ({
    date: localDate(date),
    sleepMinutes,
    hrvMs,
    restingHeartRate: null,
    source: 'Ultrahuman',
    receivedAt: `${date}T11:00:00.000Z`,
  })

  it('is the 14 mornings to today, with a gap where no night was sent', () => {
    const trend = recoveryTrend(
      [night('2026-11-11', 341, 38), night('2026-11-09', 450, 52), night('2026-10-27', 400, 50)],
      localDate('2026-11-11'),
    )
    expect(trend).toHaveLength(14)
    expect(trend[0].date).toBe('2026-10-29')
    expect(trend.at(-1)).toMatchObject({ date: '2026-11-11', night: { sleepMinutes: 341 } })
    expect(trend.at(-2)!.night).toBeNull()
    expect(trend.filter((t) => t.night).length).toBe(2)
  })
})

describe('HYROX Station times', () => {
  const line = (round: number, part: StationLog['part'], seconds: number | null): StationLog => ({
    round,
    part,
    pounds: null,
    meters: null,
    reps: null,
    seconds,
  })

  it('names the first Race simulation before there is one', () => {
    const times = stationTimes(program, [], localDate('2026-11-11'))
    expect(times.simulations).toEqual([])
    expect(times.hyrox).toEqual({})
    expect(times.firstSimulation).toEqual({ week: 16, startDate: '2027-02-22' })
  })

  it("takes each Race simulation's Station splits, and each Station's latest split in a HYROX round", () => {
    const hyrox = (week: number, date: string, push: number) =>
      log(week, 'hyrox-a', date, {
        stations: [
          line(1, 'round', 600),
          line(1, 'run', 200),
          { ...line(1, 'sled-push', push), meters: 25, pounds: 200 },
          { ...line(1, 'sled-pull', 600 - 200 - push), meters: 25, pounds: 135 },
        ],
      })
    // Before legs were timed: only the round's time, which is no Station's.
    const roundOnly = log(6, 'hyrox-a', '2026-12-19', {
      stations: [line(1, 'round', 560), line(1, 'run', null), line(1, 'sled-push', null), line(1, 'farmers-carry', null)],
    })
    const simulation = log(16, 'race-simulation', '2027-02-27', {
      stations: [line(1, 'run', 300), line(1, 'skierg', 260), line(2, 'run', 310), line(2, 'sled-push', 190)],
    })
    const times = stationTimes(
      program,
      [hyrox(3, '2026-11-28', 240), hyrox(4, '2026-12-05', 210), roundOnly, simulation],
      localDate('2027-02-28'),
    )
    expect(times.simulations).toEqual([{ week: 16, date: '2027-02-27', stations: { skierg: 260, 'sled-push': 190 } }])
    expect(times.hyrox['sled-push']).toEqual({ week: 4, date: '2026-12-05', round: 1, seconds: 210, meters: 25, reps: null })
    expect(times.hyrox['sled-pull']).toMatchObject({ week: 4, seconds: 190 })
    expect(times.hyrox['farmers-carry']).toBeUndefined()
    expect(times.hyrox.skierg).toBeUndefined()
  })

  it('leaves out what was skipped or is still ahead', () => {
    const skipped = log(16, 'race-simulation', '2027-02-27', { status: 'skipped', stations: [line(1, 'skierg', 260)] })
    expect(stationTimes(program, [skipped], localDate('2027-02-28')).simulations).toEqual([])
    const ahead = log(16, 'race-simulation', '2027-02-27', { stations: [line(1, 'skierg', 260)] })
    expect(stationTimes(program, [ahead], localDate('2027-02-26')).simulations).toEqual([])
  })
})
