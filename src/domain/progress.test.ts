import { describe, expect, it } from 'vitest'
import { localDate } from './calendar'
import type { LoggedStatus, SessionLog, StationLog } from './log'
import { ROXZONE_SECONDS } from './racePlan'
import { program } from './program/program'
import type { StationId } from './program/types'
import {
  finishSoFar,
  lanesFull,
  projectedFinish,
  raceLanes,
  raceRunSeries,
  recoveryTrend,
  stationBests,
  stationTimes,
  TRANSITION_SECONDS,
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

const line = (round: number, part: StationLog['part'], seconds: number | null, extra: Partial<StationLog> = {}): StationLog => ({
  round,
  part,
  pounds: null,
  meters: null,
  reps: null,
  seconds,
  ...extra,
})

/** A Compromised run test: four 1 km runs at these paces, each before its Station. */
const runTest = (week: number, date: string, splits: number[], extra: Parameters<typeof log>[3] = {}) =>
  log(week, 'compromised-run-test', date, {
    rpe: 9,
    stations: splits.map((s, i) => line(i + 1, 'run', s, { meters: 1000 })),
    ...extra,
  })

/** Each Station at full Station volume and Race load, as a Race simulation would log it. */
const FULL: Record<StationId, Partial<StationLog>> = {
  skierg: { meters: 1000 },
  'sled-push': { meters: 50, pounds: 335 },
  'sled-pull': { meters: 50, pounds: 227 },
  'burpee-broad-jumps': { meters: 80 },
  row: { meters: 1000 },
  'farmers-carry': { meters: 200, pounds: 55 },
  'sandbag-lunges': { meters: 100, pounds: 45 },
  'wall-balls': { reps: 100, pounds: 13 },
}

const simulation = (week: number, date: string, times: Partial<Record<StationId, number>>) =>
  log(week, 'race-simulation', date, {
    minutes: 65,
    rpe: 8,
    stations: (Object.entries(times) as [StationId, number][]).flatMap(([id, seconds], i) => [
      line(i + 1, 'run', 300, { meters: 1000 }),
      line(i + 1, id, seconds, FULL[id]),
    ]),
  })

/** Weeks 16 and 18: every Station once at full volume. Σ = 240+180+200+250+245+90+260+330 = 1795. */
const HALF_A = simulation(16, '2027-02-27', { skierg: 240, 'sled-push': 180, 'sled-pull': 200, 'burpee-broad-jumps': 250 })
const HALF_B = simulation(18, '2027-03-13', { row: 245, 'farmers-carry': 90, 'sandbag-lunges': 260, 'wall-balls': 330 })

describe('the Projected finish', () => {
  it('shares its six minutes of transitions with the race plan', () => {
    expect(TRANSITION_SECONDS).toBe(6 * 60)
    expect(ROXZONE_SECONDS).toBe(TRANSITION_SECONDS)
  })

  it('adds the eight Station bests at full volume, eight runs at Race run pace and the transitions', () => {
    const logs = [runTest(14, '2027-02-10', [290, 295, 300, 307]), HALF_A, HALF_B]
    const projected = projectedFinish(program, logs, localDate('2027-03-14'))
    expect(projected.missing).toEqual([])
    // Race run pace 298 s/km: the mean of 290, 295, 300 and 307.
    expect(projected.raceRun).toEqual({ secondsPerKm: 298, week: 14 })
    expect(projected.projection).toEqual({
      stations: 1795,
      running: 8 * 298,
      transitions: 360,
      solo: 1795 + 8 * 298 + 360,
      // Doubles: half the Station work, all the running, the same transitions.
      doubles: 1795 / 2 + 8 * 298 + 360,
    })
  })

  it('names the Stations with no best at full volume instead of a time', () => {
    // Half volume in a HYROX round, and a sled push under Race load: neither counts.
    const hyrox = log(12, 'hyrox-a', '2027-01-30', {
      stations: [line(1, 'row', 120, { meters: 500 }), line(2, 'sled-push', 150, { meters: 50, pounds: 225 })],
    })
    const logs = [runTest(14, '2027-02-10', [300, 300, 300, 300]), HALF_A, hyrox]
    const projected = projectedFinish(program, logs, localDate('2027-03-01'))
    expect(projected.projection).toBeNull()
    expect(projected.missing).toEqual(['row', 'farmers-carry', 'sandbag-lunges', 'wall-balls'])
  })

  it('has no time without a Compromised run test, even with every Station best', () => {
    const projected = projectedFinish(program, [HALF_A, HALF_B], localDate('2027-03-14'))
    expect(projected.missing).toEqual([])
    expect(projected.raceRun).toBeNull()
    expect(projected.projection).toBeNull()
  })

  it('counts only what was done by today', () => {
    const logs = [runTest(14, '2027-02-10', [300, 300, 300, 300]), HALF_A, HALF_B]
    expect(projectedFinish(program, logs, localDate('2027-03-12')).missing).toEqual([
      'row',
      'farmers-carry',
      'sandbag-lunges',
      'wall-balls',
    ])
  })
})

describe('the race in lanes', () => {
  it('runs first, then the eight Stations in race order, all empty before anything is timed', () => {
    const lanes = raceLanes(program, [], localDate('2026-11-12'))
    expect(lanes.map((l) => l.leg)).toEqual([
      'run',
      'skierg',
      'sled-push',
      'sled-pull',
      'burpee-broad-jumps',
      'row',
      'farmers-carry',
      'sandbag-lunges',
      'wall-balls',
    ])
    expect(lanes[0]).toEqual({ leg: 'run', secondsPerKm: null, week: null })
    expect(lanes.slice(1).every((l) => l.leg !== 'run' && l.reach === null)).toBe(true)
    expect(lanesFull(lanes)).toBe(0)
  })

  it('fills a Station as far as it was timed toward race volume, and never past Race load', () => {
    const hyrox = log(3, 'hyrox-a', '2026-11-24', {
      stations: [
        line(1, 'skierg', 63, { meters: 250 }),
        line(2, 'row', 130, { meters: 500 }),
        // Under Race load: another Station, so its lane stays empty.
        line(3, 'sled-push', 150, { meters: 50, pounds: 225 }),
      ],
    })
    const further = log(4, 'hyrox-b', '2026-12-01', { stations: [line(1, 'skierg', 128, { meters: 500 })] })
    const lanes = raceLanes(program, [runTest(2, '2026-11-18', [300, 300, 300, 300]), hyrox, further], localDate('2026-12-02'))
    const lane = (id: StationId) => lanes.find((l) => l.leg === id)
    expect(lanes[0]).toEqual({ leg: 'run', secondsPerKm: 300, week: 2 })
    expect(lane('skierg')).toEqual({ leg: 'skierg', reach: { share: 0.5, seconds: 128, week: 4, meters: 500, reps: null } })
    expect(lane('row')).toEqual({ leg: 'row', reach: { share: 0.5, seconds: 130, week: 3, meters: 500, reps: null } })
    expect(lane('sled-push')).toEqual({ leg: 'sled-push', reach: null })
    // Only the run is full: half a SkiErg isn't a Station best.
    expect(lanesFull(lanes)).toBe(1)
  })

  it('is nine full lanes exactly when there is a projection', () => {
    const logs = [runTest(14, '2027-02-10', [290, 295, 300, 307]), HALF_A, HALF_B]
    const today = localDate('2027-03-14')
    const lanes = raceLanes(program, logs, today)
    expect(lanesFull(lanes)).toBe(9)
    expect(projectedFinish(program, logs, today).projection).not.toBeNull()
    expect(lanes.find((l) => l.leg === 'wall-balls')).toEqual({
      leg: 'wall-balls',
      reach: { share: 1, seconds: 330, week: 18, meters: null, reps: 100 },
    })
  })
})

describe('the Projected finish in a line', () => {
  it('says nothing before any lane is full', () => {
    expect(finishSoFar(program, [], localDate('2026-11-12'))).toBeNull()
  })

  it('counts the full lanes until there is a projection', () => {
    const logs = [runTest(2, '2026-11-18', [300, 300, 300, 300]), HALF_A]
    expect(finishSoFar(program, logs, localDate('2027-03-01'))).toEqual({ lanesFull: 5 })
  })

  it('gives the Solo time and the Doubles share once all nine are full', () => {
    const logs = [runTest(14, '2027-02-10', [290, 295, 300, 307]), HALF_A, HALF_B]
    expect(finishSoFar(program, logs, localDate('2027-03-14'))).toEqual({
      solo: 1795 + 8 * 298 + 360,
      doubles: 1795 / 2 + 8 * 298 + 360,
    })
  })
})

describe('the Station bests', () => {
  it('has each of the eight Stations in race order, at race volume, with the Week it was set', () => {
    const faster = log(20, 'hyrox-b', '2027-03-20', {
      stations: [line(1, 'skierg', 236, FULL.skierg), line(2, 'row', 250, FULL.row)],
    })
    const bests = stationBests(program, [HALF_A, HALF_B, faster], localDate('2027-03-21'))
    expect(bests.map((b) => b.station)).toEqual([
      'skierg',
      'sled-push',
      'sled-pull',
      'burpee-broad-jumps',
      'row',
      'farmers-carry',
      'sandbag-lunges',
      'wall-balls',
    ])
    expect(bests[0]).toEqual({ station: 'skierg', seconds: 236, week: 20 })
    expect(bests[4]).toEqual({ station: 'row', seconds: 245, week: 18 })
  })

  it('has none for a Station never done at race volume', () => {
    const bests = stationBests(program, [HALF_A], localDate('2027-03-01'))
    expect(bests.find((b) => b.station === 'wall-balls')).toEqual({ station: 'wall-balls', seconds: null, week: null })
  })

  it('leaves out a log edited to Skipped', () => {
    const skipped = { ...HALF_A, id: 'edit', status: 'skipped' as const, updatedAt: '2027-02-28T10:00:00.000Z' }
    expect(stationBests(program, [HALF_A, skipped], localDate('2027-03-01')).every((b) => b.seconds === null)).toBe(true)
  })
})

describe('the Race run pace series', () => {
  it('has each Compromised run test from test to test, oldest first', () => {
    const logs = [runTest(9, '2027-01-13', [300, 304, 308, 312]), runTest(2, '2026-11-18', [305, 310, 315, 322])]
    expect(raceRunSeries(logs, localDate('2027-01-20')).map((t) => [t.week, t.raceRun, t.fade])).toEqual([
      [2, 313, 17],
      [9, 306, 12],
    ])
  })

  it('leaves out a test not Done, one without its four runs, one still ahead, and lets the latest edit decide', () => {
    const logs = [
      runTest(2, '2026-11-18', [305, 310, 315]),
      runTest(9, '2027-01-13', [300, 304, 308, 312]),
      runTest(9, '2027-01-13', [300, 304, 308, 312], { status: 'skipped', updatedAt: '2027-01-14T10:00:00.000Z' }),
      runTest(14, '2027-02-17', [295, 295, 295, 295]),
    ]
    expect(raceRunSeries(logs, localDate('2027-02-16'))).toEqual([])
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
      ['strength', 'partial'],
      // Never logged, it is a Late session (ADR-0007): still open, not missed.
      ['hyrox-b', 'open'],
      ['run', 'skipped'],
      ['hyrox-a', 'done'],
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
    expect(ids(7, week6)).toEqual(['strength', 'hyrox-b', 'run', 'hyrox-a', 'easy', 'easy-2'])
    expect(ids(7, week6.slice(1))).toEqual(['strength', 'hyrox-b', 'run', 'hyrox-a', 'easy'])
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
      runTest(2, '2026-11-18', [300, 300, 300, 300]),
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
    const load = trainingLoad(program, [runTest(2, '2026-11-24', [300, 300, 300, 300])], localDate('2026-11-25'))
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
