import { describe, expect, it } from 'vitest'
import { localDate } from './calendar'
import { coach, findWeek } from './coach'
import type { LoggedStatus, SessionLog } from './log'
import {
  clock,
  clockInput,
  consoleDistance,
  consoleMeters,
  currentPaces,
  formatPace,
  latestFiveKTest,
  paceFor,
  parseClock,
  runTarget,
  speedFor,
  trainingPaces,
  vdot,
  type RunContext,
} from './paces'
import { describeExercise, describeSession } from './program/describe'
import { program } from './program/program'
import type { Session } from './program/types'

describe('VDOT from a 5K test', () => {
  // Daniels' Running Formula tables: 5K time → VDOT.
  it.each([
    ['30:40', 30],
    ['25:12', 38],
    ['23:00', 42.3],
    ['20:03', 49.7],
    ['19:57', 50],
    ['17:03', 60],
  ])('%s is VDOT %d', (time, expected) => {
    expect(vdot(parseClock(time)!)).toBeCloseTo(expected, 0)
  })

  it('rises as the time drops', () => {
    expect(vdot(19 * 60)).toBeGreaterThan(vdot(20 * 60))
  })
})

describe('Training paces', () => {
  it('match the Program’s example for a 23:00 test', () => {
    // docs/training-plan.md: about 4:36 5K pace, ~4:55 threshold (12.2 km/h), ~5:50–6:30 easy.
    const paces = trainingPaces(23 * 60)
    expect(clock(paces.fiveK)).toBe('4:36')
    expect(paces.threshold).toBeGreaterThanOrEqual(4 * 60 + 50)
    expect(paces.threshold).toBeLessThanOrEqual(4 * 60 + 55)
    expect(speedFor(paces.threshold, 'kmh')).toBeCloseTo(12.2, 0)
    expect(paces.easy.map(clock)).toEqual(['5:51', '6:26'])
  })

  // Daniels' tables: threshold pace per km for VDOT 50 is 4:15, for VDOT 60 3:40.
  it.each([
    ['19:57', '4:15'],
    ['17:03', '3:40'],
  ])('a %s test gives Threshold pace of about %s/km', (time, expected) => {
    expect(Math.abs(trainingPaces(parseClock(time)!).threshold - parseClock(expected)!)).toBeLessThanOrEqual(2)
  })

  it('are ordered: 5K faster than Threshold faster than Easy', () => {
    for (const minutes of [17, 20, 23, 26, 30]) {
      const p = trainingPaces(minutes * 60)
      expect(p.fiveK).toBeLessThan(p.threshold)
      expect(p.threshold).toBeLessThan(p.easy[0])
      expect(p.easy[0]).toBeLessThan(p.easy[1])
    }
  })
})

describe('estimated Training paces', () => {
  const today = localDate('2026-11-11')
  const test = (resultSeconds: number, date = '2026-11-04'): SessionLog =>
    ({
      id: `t-${date}`,
      week: 2,
      sessionId: '5k-test',
      date: localDate(date),
      status: 'done',
      resultSeconds,
      updatedAt: `${date}T20:00:00.000Z`,
    }) as SessionLog

  it('come from the Starting point’s estimated 5K time when no 5K test is logged, marked as an estimate', () => {
    const estimated = currentPaces([], today, 21 * 60)
    const logged = currentPaces([test(21 * 60)], today, null)
    expect(estimated).toEqual({ ...logged, estimate: true })
    expect(logged?.estimate).toBe(false)
  })

  it('give way to the first real 5K test', () => {
    expect(currentPaces([test(23 * 60)], today, 21 * 60)).toEqual(trainingPaces(23 * 60))
    // A test logged after today doesn't count yet: the estimate stands.
    expect(currentPaces([test(23 * 60, '2026-11-18')], today, 21 * 60)?.fromSeconds).toBe(21 * 60)
  })

  it('stay null with neither, so runs go by RPE', () => {
    expect(currentPaces([], today, null)).toBeNull()
  })

  it('reach the Coach, which shows them for the runs', () => {
    const week2 = localDate('2026-11-03')
    const day = coach({ program, today: week2, startingPoint: { fiveKSeconds: 21 * 60, weights: {}, updatedAt: 'x' } })
    expect(day.paces).toEqual({ ...trainingPaces(21 * 60), estimate: true })
    expect(day.fiveKTest).toBeNull()
    expect(coach({ program, today: week2 }).paces).toBeNull()
  })
})

describe('paceFor', () => {
  const paces = trainingPaces(23 * 60)

  it('reads each pace reference, and faster-than offsets', () => {
    expect(paceFor({ pace: '5k' }, paces)).toEqual([276, 276])
    expect(paceFor({ pace: 'threshold' }, paces)).toEqual([paces.threshold, paces.threshold])
    expect(paceFor({ pace: 'easy' }, paces)).toEqual(paces.easy)
    expect(paceFor({ pace: 'goal' }, paces)).toEqual([264, 264])
    expect(paceFor({ pace: '5k', secondsPerKmFaster: 5 }, paces)).toEqual([271, 271])
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
    expect(formatPace([351, 386], 'indoor', 'kmh')).toBe('9.3–10.3 km/h · 5:51–6:26/km · 1% incline')
    expect(formatPace([351, 386], 'outdoor', 'kmh')).toBe('5:51–6:26/km')
  })

  it('has nothing exact to say before the baseline 5K test', () => {
    expect(runTarget({ pace: 'threshold' }, { paces: null, environment: 'indoor', unit: 'kmh' })).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// The Coach and Session descriptions with paces.

let nextId = 0
function log(week: number, sessionId: string, date: string, change: Partial<SessionLog> = {}): SessionLog {
  return {
    id: `log-${String(++nextId).padStart(4, '0')}`,
    week,
    sessionId,
    date: localDate(date),
    status: 'done' as LoggedStatus,
    minutes: 45,
    rpe: 9,
    notes: null,
    resultSeconds: null,
    environment: null,
    distanceMeters: null,
    intervals: [],
    sets: [],
    stations: [],
    updatedAt: '2026-11-08T12:00:00.000Z',
    ...change,
  }
}

const session = (week: number, id: string): Session => findWeek(program, week)!.sessions.find((s) => s.id === id)!
const indoor = (minutes: number): RunContext => ({ paces: trainingPaces(minutes * 60), environment: 'indoor', unit: 'kmh' })
const outdoor = (minutes: number): RunContext => ({ ...indoor(minutes), environment: 'outdoor' })

describe('the latest 5K test', () => {
  const baseline = log(2, '5k-test', '2026-11-04', { resultSeconds: 1380, environment: 'indoor' })
  const second = log(8, '5k-test', '2026-12-16', { resultSeconds: 1320, environment: 'indoor' })

  it('sets no paces before the baseline test', () => {
    const day = coach({ program, today: localDate('2026-11-03'), logs: [] })
    expect(day.paces).toBeNull()
    expect(describeSession(session(1, 'threshold'), { paces: day.paces, environment: 'indoor', unit: 'kmh' }).target).toBe(
      'Threshold effort, RPE 6–7 · 2′ jog',
    )
  })

  it('sets the paces from the baseline test on', () => {
    const day = coach({ program, today: localDate('2026-11-04'), logs: [baseline] })
    expect(day.fiveKTest).toBe(baseline)
    expect(day.paces?.fromSeconds).toBe(1380)
  })

  it('is the latest by date, and ignores tests after today', () => {
    expect(latestFiveKTest([second, baseline], localDate('2026-12-20'))).toBe(second)
    expect(latestFiveKTest([second, baseline], localDate('2026-12-15'))).toBe(baseline)
  })

  it('counts only a Done test with a time', () => {
    const partial = log(8, '5k-test', '2026-12-16', { status: 'partial', resultSeconds: 1320 })
    const noTime = log(8, '5k-test', '2026-12-17')
    expect(latestFiveKTest([baseline, partial, noTime], localDate('2026-12-20'))).toBe(baseline)
  })

  it('takes the later edit of two tests on the same day', () => {
    const redo = { ...second, id: 'redo-log', resultSeconds: 1300, updatedAt: '2026-12-16T20:00:00.000Z' }
    expect(latestFiveKTest([redo, second], localDate('2026-12-20'))).toBe(redo)
  })
})

describe('run Prescriptions with Training paces', () => {
  it('give Threshold an exact speed indoors and pace outdoors', () => {
    expect(describeSession(session(3, 'threshold'), indoor(23)).target).toBe('12.3 km/h · 4:52/km · 1% incline · RPE 6–7 · 2′ jog')
    expect(describeSession(session(3, 'threshold'), { ...indoor(23), unit: 'mph' }).target).toBe(
      '7.7 mph · 4:52/km · 1% incline · RPE 6–7 · 2′ jog',
    )
    expect(describeSession(session(3, 'threshold'), outdoor(23)).target).toBe('4:52/km · RPE 6–7 · 2′ jog')
  })

  it('give 5K-pace intervals the 5K pace, and faster-than reps the faster pace', () => {
    expect(describeSession(session(4, 'speed'), outdoor(23)).target).toBe('4:36/km · 90″ jog · 4 accelerations first')
    expect(describeSession(session(13, 'speed'), outdoor(23)).target).toMatch(/^4:31\/km · /)
  })

  it('give the Easy run an easy range', () => {
    expect(describeSession(session(3, 'easy'), indoor(23)).target).toBe('9.3–10.3 km/h · 5:51–6:26/km · 1% incline · RPE 2–4')
  })

  it('leave efforts by feel as they are', () => {
    expect(describeSession(session(3, 'speed'), indoor(23)).target).toMatch(/^Hard, by feel/)
    expect(describeSession(session(8, '5k-test'), indoor(23)).target).toBe('5 km all-out · 4 strides first')
  })

  it('reach every run in a Week’s Session list, warm-ups included', () => {
    const warmUp = session(3, 'threshold').blocks[0].exercises[0]
    expect(describeExercise(warmUp, program.stations, outdoor(23)).detail).toBe('10 min · 5:51–6:26/km · RPE 2–4')
  })
})

describe('Deload weeks', () => {
  it('run Speed as the Program specifies: 4 × 2′ at Threshold pace, not 5 × 3′ at 5K pace', () => {
    const normal = session(4, 'speed')
    const deload = session(7, 'speed')
    expect(findWeek(program, 7)!.deload).toBe(true)
    expect(describeSession(normal, indoor(23)).summary).toBe('5 × 3′ at 5K pace / 90″ jog')
    expect(describeSession(deload, indoor(23)).summary).toBe('4 × 2′ controlled / 2′ jog')
    expect(describeSession(deload, indoor(23)).target).toBe('12.3 km/h · 4:52/km · 1% incline · 2′ jog · 2 accelerations first')
  })

  it('cut the main run volume by about a third', () => {
    const runSeconds = (s: Session) =>
      s.blocks
        .filter((b) => b.main)
        .flatMap((b) => b.exercises)
        .reduce((sum, e) => (e.prescription.kind === 'intervals' ? sum + e.prescription.reps * e.prescription.workSeconds : sum), 0)
    // Week 6 (Speed 4 × 4′, the Week before) against Deload Week 7 (4 × 2′).
    const ratio = runSeconds(session(7, 'speed')) / runSeconds(session(6, 'speed'))
    expect(ratio).toBeLessThanOrEqual(2 / 3)
  })

  it('replace Threshold with an easy run at Easy pace', () => {
    expect(describeSession(session(7, 'easy-deload'), outdoor(23)).target).toBe('5:51–6:26/km · RPE 2–4')
  })
})
