import { describe, expect, it } from 'vitest'
import { localDate } from './calendar'
import { coach, findWeek } from './coach'
import {
  clock,
  clockInput,
  consoleDistance,
  consoleMeters,
  currentPaces,
  formatPace,
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

describe('VDOT from a 5K time', () => {
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
  it('give a 23:00 estimate about 4:52 Threshold, Race run pace 15 s/km slower, and 5:51–6:26 easy', () => {
    const paces = trainingPaces(23 * 60)
    expect(paces.threshold).toBeGreaterThanOrEqual(4 * 60 + 50)
    expect(paces.threshold).toBeLessThanOrEqual(4 * 60 + 55)
    expect(speedFor(paces.threshold, 'kmh')).toBeCloseTo(12.2, 0)
    expect(paces.raceRun).toBe(paces.threshold + 15)
    expect(paces.easy.map(clock)).toEqual(['5:51', '6:26'])
  })

  // Daniels' tables: threshold pace per km for VDOT 50 is 4:15, for VDOT 60 3:40.
  it.each([
    ['19:57', '4:15'],
    ['17:03', '3:40'],
  ])('a %s estimate gives Threshold pace of about %s/km', (time, expected) => {
    expect(Math.abs(trainingPaces(parseClock(time)!).threshold - parseClock(expected)!)).toBeLessThanOrEqual(2)
  })

  it('are ordered: Threshold faster than Race run pace faster than Easy', () => {
    for (const minutes of [17, 20, 23, 26, 30]) {
      const p = trainingPaces(minutes * 60)
      expect(p.threshold).toBeLessThan(p.raceRun)
      expect(p.raceRun).toBeLessThan(p.easy[0])
      expect(p.easy[0]).toBeLessThan(p.easy[1])
    }
  })
})

describe('estimated Training paces', () => {
  it('come from the Starting point’s estimate, marked as an estimate', () => {
    expect(currentPaces(21 * 60)).toEqual({ ...trainingPaces(21 * 60), estimate: true })
  })

  it('stay null without one, so runs go by RPE', () => {
    expect(currentPaces(null)).toBeNull()
  })

  it('reach the Coach, which shows them for the runs', () => {
    const week2 = localDate('2026-11-17')
    const day = coach({ program, today: week2, startingPoint: { fiveKSeconds: 21 * 60, weights: {}, updatedAt: 'x' } })
    expect(day.paces).toEqual({ ...trainingPaces(21 * 60), estimate: true })
    expect(coach({ program, today: week2 }).paces).toBeNull()
  })
})

describe('paceFor', () => {
  const paces = trainingPaces(23 * 60)

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
    expect(formatPace([351, 386], 'indoor', 'kmh')).toBe('9.3–10.3 km/h · 5:51–6:26/km · 1% incline')
    expect(formatPace([351, 386], 'outdoor', 'kmh')).toBe('5:51–6:26/km')
  })

  it('has nothing exact to say without Training paces', () => {
    expect(runTarget({ pace: 'threshold' }, { paces: null, environment: 'indoor', unit: 'kmh' })).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// The Coach and Session descriptions with paces.

const session = (week: number, id: string): Session => findWeek(program, week)!.sessions.find((s) => s.id === id)!
const indoor = (minutes: number): RunContext => ({ paces: trainingPaces(minutes * 60), environment: 'indoor', unit: 'kmh' })
const outdoor = (minutes: number): RunContext => ({ ...indoor(minutes), environment: 'outdoor' })

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
    expect(describeSession(session(3, 'run'), indoor(23)).target).toBe('12.3 km/h · 4:52/km · 1% incline · RPE 6–7 · 90″ jog')
    expect(describeSession(session(3, 'run'), { ...indoor(23), unit: 'mph' }).target).toBe(
      '7.7 mph · 4:52/km · 1% incline · RPE 6–7 · 90″ jog',
    )
    expect(describeSession(session(3, 'run'), outdoor(23)).target).toBe('4:52/km · RPE 6–7 · 90″ jog')
  })

  it('give Compromised intervals Race run pace', () => {
    expect(describeSession(session(6, 'run'), outdoor(23)).target).toBe('1 km, then Wall balls, each round · Race load · 5:07/km')
    expect(describeSession(session(6, 'run'), indoor(23)).target).toBe(
      '1 km, then Wall balls, each round · Race load · 11.7 km/h · 5:07/km · 1% incline',
    )
  })

  it('give the Easy run an easy range', () => {
    expect(describeSession(session(3, 'easy'), indoor(23)).target).toBe('9.3–10.3 km/h · 5:51–6:26/km · 1% incline · RPE 2–4')
  })

  it('leave efforts by feel as they are: the test’s runs are all-out', () => {
    expect(describeSession(session(2, 'compromised-run-test'), indoor(23)).target).toBe('1 km, then Station, each round · Race load · all-out')
  })

  it('reach every run in a Week’s Session list, warm-ups included', () => {
    const warmUp = session(3, 'run').blocks[0].exercises[0]
    expect(describeExercise(warmUp, program.stations, outdoor(23)).detail).toBe('10 min · 5:51–6:26/km · RPE 2–4')
  })
})

describe('Deload weeks', () => {
  it('replace the Run with 35 minutes at Easy pace', () => {
    expect(findWeek(program, 5)!.deload).toBe(true)
    expect(describeSession(session(5, 'run'), outdoor(23))).toMatchObject({ summary: '35 min easy', target: '5:51–6:26/km · RPE 2–4' })
  })
})
