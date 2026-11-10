import { describe, expect, it } from 'vitest'
import { localDate } from './calendar'
import { coach, findWeek } from './coach'
import type { SessionLog, StationLog } from './log'
import {
  clock,
  clockInput,
  consoleDistance,
  consoleMeters,
  currentPaces,
  fade,
  formatPace,
  latestRunTest,
  paceFor,
  parseClock,
  runTarget,
  runTestResult,
  speedFor,
  trainingPaces,
  type RunContext,
} from './paces'
import { describeExercise, describeSession } from './program/describe'
import { program } from './program/program'
import type { Session } from './program/types'

const TEST_STATIONS = ['skierg', 'sled-push', 'row', 'wall-balls'] as const

/** A Compromised run test's Station logs as Live writes them: each round a 1 km run, then its Station. */
function testLines(splits: (number | null)[], stationSeconds = 150): StationLog[] {
  return splits.flatMap((seconds, i): StationLog[] => [
    { round: i + 1, part: 'run', pounds: null, meters: 1000, reps: null, seconds },
    { round: i + 1, part: TEST_STATIONS[i], pounds: null, meters: null, reps: null, seconds: stationSeconds },
  ])
}

function testLog(week: number, date: string, splits: (number | null)[], extra: Partial<SessionLog> = {}): SessionLog {
  return {
    id: `log-test-${week}-${date}`,
    week,
    sessionId: 'compromised-run-test',
    date: localDate(date),
    status: 'done',
    minutes: 45,
    rpe: 9,
    notes: null,
    resultSeconds: null,
    environment: 'indoor',
    distanceMeters: null,
    recoveryPace: null,
    intervals: [],
    sets: [],
    stations: testLines(splits),
    updatedAt: `${date}T20:00:00.000Z`,
    ...extra,
  }
}

describe('Training paces', () => {
  it('take Race run pace as the base: Threshold 15 s/km faster, Easy 60 to 90 s/km slower', () => {
    const paces = trainingPaces(5 * 60 + 7)
    expect(clock(paces.raceRun)).toBe('5:07')
    expect(clock(paces.threshold)).toBe('4:52')
    expect(paces.easy.map(clock)).toEqual(['6:07', '6:37'])
    expect(speedFor(paces.threshold, 'kmh')).toBe(12.3)
    expect(paces.estimate).toBe(false)
  })
})

describe('the Compromised run test', () => {
  const splits = [290, 300, 305, 313]

  it('sets Race run pace to the mean of its four run splits, to the second', () => {
    expect(runTestResult(testLog(2, '2026-11-18', splits))).toEqual({
      week: 2,
      date: '2026-11-18',
      splits,
      raceRun: 302,
      fade: 23,
    })
  })

  it('shows the Fade, the fourth split less the first: negative when the last run was the fastest', () => {
    expect(runTestResult(testLog(2, '2026-11-18', [300, 298, 296, 294]))!.fade).toBe(-6)
    expect(fade(testLines(splits))).toBe(23)
    expect(fade(testLines([300]))).toBeNull()
  })

  it('measures a HYROX Session’s Fade from its first run to its last: run 1 against run 8 of 8 rounds', () => {
    // 400 m runs at Race run pace, the fifth eased to recover: it's logged as run, and counts like any other.
    const seconds = [126, 124, 128, 130, 150, 132, 134, 135]
    const lines = seconds.flatMap((s, i): StationLog[] => [
      { round: i + 1, part: 'skierg', pounds: null, meters: 250, reps: null, seconds: 60 },
      { round: i + 1, part: 'run', pounds: null, meters: 400, reps: null, seconds: s },
    ])
    // 126 s / 0.4 km = 315 s/km; 135 s / 0.4 km = 338 s/km (337.5, to the second).
    expect(fade(lines.toReversed())).toBe(338 - 315)
  })

  it('counts only a Done test with all four runs timed', () => {
    expect(runTestResult(testLog(2, '2026-11-18', splits, { status: 'partial' }))).toBeNull()
    expect(runTestResult(testLog(2, '2026-11-18', [290, 300, 305, null]))).toBeNull()
    expect(runTestResult(testLog(2, '2026-11-18', [290, 300, 305]))).toBeNull()
    expect(runTestResult({ ...testLog(2, '2026-11-18', splits), sessionId: 'hyrox-a' })).toBeNull()
  })

  it('is the latest Done one on or before today', () => {
    const logs = [testLog(9, '2027-01-06', [280, 285, 290, 295]), testLog(2, '2026-11-18', splits)]
    expect(latestRunTest(logs, localDate('2026-11-17'))).toBeNull()
    expect(latestRunTest(logs, localDate('2026-11-18'))!.week).toBe(2)
    expect(latestRunTest(logs, localDate('2027-01-05'))!.week).toBe(2)
    expect(latestRunTest(logs, localDate('2027-01-06'))!.raceRun).toBe(288)
  })
})

describe('current Training paces', () => {
  it('come from the latest Done test, from its day on, whatever the estimate', () => {
    const logs = [testLog(2, '2026-11-18', [290, 300, 305, 313])]
    expect(currentPaces(logs, 330, localDate('2026-11-18'))).toEqual(trainingPaces(302))
    expect(currentPaces(logs, 330, localDate('2026-11-17'))).toEqual(trainingPaces(330, { estimate: true }))
  })

  it('before any test, are estimated from the Starting point’s split exactly as from a test', () => {
    expect(currentPaces([], 330, localDate('2026-11-10'))).toEqual({ ...trainingPaces(330), estimate: true })
  })

  it('stay null without a test or an estimate, so runs go by RPE', () => {
    expect(currentPaces([], null, localDate('2026-11-10'))).toBeNull()
  })

  it('reach the Coach, which shows them for the runs', () => {
    const week2 = localDate('2026-11-17')
    const startingPoint = { splitSeconds: 330, weights: {}, updatedAt: 'x' }
    expect(coach({ program, today: week2, startingPoint }).paces).toEqual(trainingPaces(330, { estimate: true }))
    expect(coach({ program, today: week2 }).paces).toBeNull()
    const logs = [testLog(2, '2026-11-17', [290, 300, 305, 313])]
    expect(coach({ program, today: week2, startingPoint, logs }).paces).toEqual(trainingPaces(302))
  })
})

describe('paceFor', () => {
  const paces = trainingPaces(307)

  it('reads each pace reference, and faster-than offsets', () => {
    expect(paceFor({ pace: 'race-run' }, paces)).toEqual([paces.raceRun, paces.raceRun])
    expect(paceFor({ pace: 'threshold' }, paces)).toEqual([paces.threshold, paces.threshold])
    expect(paceFor({ pace: 'easy' }, paces)).toEqual(paces.easy)
    expect(paceFor({ pace: 'threshold', secondsPerKmFaster: 5 }, paces)).toEqual([paces.threshold - 5, paces.threshold - 5])
  })

  it('leaves efforts by feel alone, except controlled, which is Threshold', () => {
    expect(paceFor({ feel: 'hard' }, paces)).toBeNull()
    expect(paceFor({ feel: 'all-out' }, paces)).toBeNull()
    expect(paceFor({ feel: 'controlled' }, paces)).toEqual([paces.threshold, paces.threshold])
  })
})

describe('units', () => {
  it('converts a pace to treadmill speed in km/h and mph, to one decimal', () => {
    expect(speedFor(240, 'kmh')).toBe(15)
    expect(speedFor(240, 'mph')).toBe(9.3)
    expect(speedFor(292, 'kmh')).toBe(12.3)
    expect(speedFor(292, 'mph')).toBe(7.7)
    expect(speedFor(360, 'kmh')).toBe(10)
    expect(speedFor(360, 'mph')).toBe(6.2)
  })

  it('reads a console distance in the treadmill units and stores meters', () => {
    expect(consoleMeters(5, 'kmh')).toBe(5000)
    expect(consoleMeters(3.1, 'mph')).toBe(4989)
    expect(consoleMeters(Number.NaN, 'mph')).toBeNull()
    expect(consoleDistance(5000, 'kmh')).toBe(5)
    expect(consoleDistance(4989, 'mph')).toBe(3.1)
    expect(consoleDistance(null, 'mph')).toBeNaN()
  })

  it('reads and writes clock times', () => {
    expect(parseClock('23:00')).toBe(1380)
    expect(parseClock(' 9:05 ')).toBe(545)
    expect(parseClock('23:60')).toBeNull()
    expect(parseClock('23')).toBeNull()
    expect(parseClock('1:23:00')).toBeNull()
    expect(clock(1380)).toBe('23:00')
    expect(clock(545)).toBe('9:05')
  })

  it('reads clock times typed on a number pad, with no colon', () => {
    expect(parseClock('1945')).toBe(1185)
    expect(parseClock('452')).toBe(292)
    expect(parseClock('1960')).toBeNull()
    expect(parseClock('12345')).toBeNull()
    expect(clockInput('1')).toBe('1')
    expect(clockInput('45')).toBe('45')
    expect(clockInput('452')).toBe('4:52')
    expect(clockInput('1945')).toBe('19:45')
    expect(clockInput('19456')).toBe('19:45')
  })
})

describe('Indoor versus Outdoor', () => {
  it('reads Indoor as speed, pace per km and 1% incline, Outdoor as pace per km', () => {
    expect(formatPace([292, 292], 'indoor', 'kmh')).toBe('12.3 km/h · 4:52/km · 1% incline')
    expect(formatPace([292, 292], 'indoor', 'mph')).toBe('7.7 mph · 4:52/km · 1% incline')
    expect(formatPace([292, 292], 'outdoor', 'kmh')).toBe('4:52/km')
    expect(formatPace([292, 292], 'outdoor', 'mph')).toBe('4:52/km')
  })

  it('reads a range slow to fast on the treadmill and fast to slow outside', () => {
    expect(formatPace([367, 397], 'indoor', 'kmh')).toBe('9.1–9.8 km/h · 6:07–6:37/km · 1% incline')
    expect(formatPace([367, 397], 'outdoor', 'kmh')).toBe('6:07–6:37/km')
  })

  it('has nothing exact to say without Training paces', () => {
    expect(runTarget({ pace: 'threshold' }, { paces: null, environment: 'indoor', unit: 'kmh' })).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// The Coach and Session descriptions with paces.

const session = (week: number, id: string): Session => findWeek(program, week)!.sessions.find((s) => s.id === id)!
const indoor = (raceRun: number): RunContext => ({ paces: trainingPaces(raceRun), environment: 'indoor', unit: 'kmh' })
const outdoor = (raceRun: number): RunContext => ({ ...indoor(raceRun), environment: 'outdoor' })

describe('without an estimate', () => {
  it('sets no paces, and the Run goes by effort and RPE', () => {
    const day = coach({ program, today: localDate('2026-11-09'), logs: [] })
    expect(day.paces).toBeNull()
    expect(describeSession(session(1, 'run'), { paces: day.paces, environment: 'indoor', unit: 'kmh' }).target).toBe(
      'Threshold effort, RPE 6–7 · 90″ jog',
    )
  })
})

describe('run Prescriptions with Training paces', () => {
  it('give Threshold reps an exact speed indoors and pace outdoors', () => {
    expect(describeSession(session(3, 'run'), indoor(307)).target).toBe('12.3 km/h · 4:52/km · 1% incline · RPE 6–7 · 90″ jog')
    expect(describeSession(session(3, 'run'), { ...indoor(307), unit: 'mph' }).target).toBe(
      '7.7 mph · 4:52/km · 1% incline · RPE 6–7 · 90″ jog',
    )
    expect(describeSession(session(3, 'run'), outdoor(307)).target).toBe('4:52/km · RPE 6–7 · 90″ jog')
  })

  it('give Compromised intervals Race run pace', () => {
    expect(describeSession(session(6, 'run'), outdoor(307)).target).toBe('1 km, then Wall balls, each round · Race load · 5:07/km')
    expect(describeSession(session(6, 'run'), indoor(307)).target).toBe(
      '1 km, then Wall balls, each round · Race load · 11.7 km/h · 5:07/km · 1% incline',
    )
  })

  it('give the Easy run an easy range', () => {
    expect(describeSession(session(3, 'easy'), indoor(307)).target).toBe('9.1–9.8 km/h · 6:07–6:37/km · 1% incline · RPE 2–4')
  })

  it('leave efforts by feel as they are: the test’s runs are all-out', () => {
    expect(describeSession(session(2, 'compromised-run-test'), indoor(307)).target).toBe('1 km, then Station, each round · Race load · all-out')
  })

  it('reach every run in a Week’s Session list, warm-ups included', () => {
    const warmUp = session(3, 'run').blocks[0].exercises[0]
    expect(describeExercise(warmUp, program.stations, outdoor(307)).detail).toBe('10 min · 6:07–6:37/km · RPE 2–4')
  })
})

describe('Deload weeks', () => {
  it('replace the Run with 35 minutes at Easy pace', () => {
    expect(findWeek(program, 5)!.deload).toBe(true)
    expect(describeSession(session(5, 'run'), outdoor(307))).toMatchObject({ summary: '35 min easy', target: '6:07–6:37/km · RPE 2–4' })
  })
})
