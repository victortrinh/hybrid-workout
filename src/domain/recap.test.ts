import { describe, expect, it } from 'vitest'
import { localDate } from './calendar'
import { RACE_SECONDS, RACE_SESSION_ID, resultRange, type SessionLog } from './log'
import { program } from './program/program'
import { afterRace, finishClock, finishInput, finishLog, parseFinish, programRecap, raceResult } from './recap'
import type { WorkingWeightChange } from './weights'

let n = 0
function log(week: number, sessionId: string, date: string, extra: Partial<SessionLog> = {}): SessionLog {
  n += 1
  return {
    id: `log-${String(n).padStart(4, '0')}`,
    week,
    sessionId,
    date: localDate(date),
    status: 'done',
    minutes: 45,
    rpe: 6,
    notes: null,
    resultSeconds: null,
    environment: null,
    distanceMeters: null,
    intervals: [],
    sets: [],
    stations: [],
    updatedAt: `${date}T20:00:00.000Z`,
    ...extra,
  }
}

const change = (lift: WorkingWeightChange['lift'], week: number, pounds: number, reason: WorkingWeightChange['reason']) =>
  ({ lift, week, pounds, reason, date: localDate('2026-10-26') }) as WorkingWeightChange

const DAY_AFTER = localDate('2027-04-22')

describe('after Race day', () => {
  it('starts the day after Race day, not on it', () => {
    expect(afterRace(program, localDate('2027-04-21'))).toBe(false)
    expect(afterRace(program, DAY_AFTER)).toBe(true)
    expect(afterRace(program, localDate('2027-05-30'))).toBe(true)
  })
})

describe('the race result', () => {
  it('asks for the finish time with no race log', () => {
    expect(raceResult(program, [], DAY_AFTER)).toEqual({ state: 'ask', log: null })
  })

  it('asks for the finish time when the race was logged without one', () => {
    const race = log(26, RACE_SESSION_ID, '2027-04-21', { minutes: 84, rpe: 10 })
    expect(raceResult(program, [race], DAY_AFTER)).toEqual({ state: 'ask', log: race })
  })

  it('has the finish time once it is logged, the latest edit standing', () => {
    const first = log(26, RACE_SESSION_ID, '2027-04-21', { resultSeconds: 5100 })
    const edit = { ...first, resultSeconds: 5047, updatedAt: '2027-04-22T12:00:00.000Z' }
    expect(raceResult(program, [first, edit], DAY_AFTER)).toEqual({ state: 'finished', log: edit, seconds: 5047 })
  })

  it('says the race was Skipped instead of asking', () => {
    const race = log(26, RACE_SESSION_ID, '2027-04-21', { status: 'skipped', minutes: null, rpe: null })
    expect(raceResult(program, [race], DAY_AFTER)).toEqual({ state: 'skipped', log: race })
  })

  it('takes a HYROX finish between 30 minutes and 4 hours', () => {
    expect(RACE_SECONDS).toEqual([30 * 60, 4 * 60 * 60])
  })

  it('bounds a result time by its Session: a 5K test or the race, nothing else', () => {
    expect(resultRange('5k-test')).toEqual([12 * 60, 60 * 60])
    expect(resultRange(RACE_SESSION_ID)).toEqual(RACE_SECONDS)
    expect(resultRange('speed')).toBeNull()
  })
})

describe('the Program recap', () => {
  it('runs the 5K tests from the first to the last', () => {
    const logs = [
      log(2, '5k-test', '2026-11-04', { resultSeconds: 1380 }),
      log(8, '5k-test', '2026-12-16', { resultSeconds: 1335 }),
      log(24, '5k-test', '2027-04-07', { resultSeconds: 1195 }),
    ]
    const { fiveK } = programRecap(program, logs, [], DAY_AFTER)
    expect(fiveK).toEqual({ first: { week: 2, seconds: 1380 }, last: { week: 24, seconds: 1195 }, sub20: true })
  })

  it('has no 5K line without a test, and one test is both ends', () => {
    expect(programRecap(program, [], [], DAY_AFTER).fiveK).toBeNull()
    const one = [log(2, '5k-test', '2026-11-04', { resultSeconds: 1380 })]
    expect(programRecap(program, one, [], DAY_AFTER).fiveK).toEqual({
      first: { week: 2, seconds: 1380 },
      last: { week: 2, seconds: 1380 },
      sub20: false,
    })
  })

  it('puts each Working weight where calibration found it and where it is now', () => {
    const changes = [
      change('back-squat', 1, 185, 'calibration'),
      change('back-squat', 6, 205, 'all-reps-easy'),
      change('romanian-deadlift', 1, 135, 'calibration'),
    ]
    expect(programRecap(program, [], changes, DAY_AFTER).workingWeights).toEqual([
      { lift: 'back-squat', first: 185, now: 205 },
      { lift: 'romanian-deadlift', first: 135, now: 135 },
    ])
  })

  it('counts Sessions done against the required ones, the Easy runs on top', () => {
    const logs = [
      log(1, 'speed', '2026-10-26'),
      log(1, 'strength', '2026-10-28', { status: 'partial' }),
      log(1, 'threshold', '2026-10-30', { status: 'skipped', minutes: null, rpe: null }),
      log(1, 'easy', '2026-10-31'),
    ]
    const { sessions } = programRecap(program, logs, [], DAY_AFTER)
    const required = program.phases
      .flatMap((p) => p.weeks)
      .flatMap((w) => w.sessions)
      .filter((s) => !s.optional).length
    expect(sessions).toEqual({ done: 2, required, easy: 1 })
  })

  it('adds up the Training load of the whole Program, the race included', () => {
    const logs = [
      log(1, 'speed', '2026-10-26', { minutes: 50, rpe: 8 }),
      log(26, RACE_SESSION_ID, '2027-04-21', { minutes: 84, rpe: 10 }),
    ]
    expect(programRecap(program, logs, [], DAY_AFTER).trainingLoad).toEqual({
      total: 50 * 8 + 84 * 10,
      byLane: { speed: 50 * 8, hyrox: 84 * 10 },
    })
  })
})

describe('the finish time as typed', () => {
  it('reads h:mm:ss, the digits alone, or minutes past the hour', () => {
    expect(parseFinish('1:24:07')).toBe(5047)
    expect(parseFinish('12407')).toBe(5047)
    expect(parseFinish('84:07')).toBe(5047)
    expect(parseFinish(' 0:58:30 ')).toBe(3510)
    expect(parseFinish('1:64:07')).toBeNull()
    expect(parseFinish('fast')).toBeNull()
    expect(parseFinish('')).toBeNull()
  })

  it('shows typed digits as a clock while they are typed', () => {
    expect(finishInput('1')).toBe('1')
    expect(finishInput('124')).toBe('1:24')
    expect(finishInput('12407')).toBe('1:24:07')
    expect(finishInput('1:24:07x')).toBe('1:24:07')
  })

  it('writes a finish time as h:mm:ss', () => {
    expect(finishClock(5047)).toBe('1:24:07')
    expect(finishClock(3510)).toBe('58:30')
  })
})

describe('logging the finish time in one step', () => {
  it('logs the race Done on Race day, its minutes from the time', () => {
    const made = finishLog(program, null, 5047, { id: 'new', updatedAt: '2027-04-22T14:00:00.000Z' })
    expect(made).toMatchObject({
      id: 'new',
      week: 26,
      sessionId: RACE_SESSION_ID,
      date: '2027-04-21',
      status: 'done',
      minutes: 84,
      rpe: null,
      resultSeconds: 5047,
      updatedAt: '2027-04-22T14:00:00.000Z',
    })
  })

  it('adds the time to a race already logged, keeping the rest of it', () => {
    const race = log(26, RACE_SESSION_ID, '2027-04-21', { minutes: 90, rpe: 10, notes: 'Wall balls. Never again.' })
    const made = finishLog(program, race, 5047, { id: 'ignored', updatedAt: '2027-04-22T14:00:00.000Z' })
    expect(made).toEqual({ ...race, status: 'done', resultSeconds: 5047, updatedAt: '2027-04-22T14:00:00.000Z' })
  })
})
