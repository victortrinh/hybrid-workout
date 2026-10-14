import { describe, expect, it } from 'vitest'
import { localDate } from './calendar'
import { findWeek } from './coach'
import { DEFAULT_EQUIPMENT, equip } from './equipment'
import {
  addSet,
  currentSet,
  endRest,
  finish,
  keepGoing,
  liftsLog,
  liftsStatus,
  logSet,
  parseLiveLifts,
  restLeft,
  setLoad,
  setReps,
  setRpe,
  startLifts,
  type LiveLifts,
} from './lifts'
import { parseSessionLog } from './log'
import { program } from './program/program'
import type { WorkingWeights } from './weights'

const T0 = Date.parse('2026-11-04T17:00:00Z')
const at = (seconds: number) => T0 + seconds * 1000

const WEIGHTS: WorkingWeights = {
  'back-squat': 185,
  'romanian-deadlift': 135,
  'bulgarian-split-squat': 30,
  'single-leg-calf-raise': 35,
  'seated-calf-raise': 65,
}

const start = (week: number, weights: WorkingWeights = WEIGHTS): LiveLifts => {
  const session = equip(findWeek(program, week)!.sessions.find((s) => s.id === 'strength')!, DEFAULT_EQUIPMENT)
  return startLifts({ week, session, date: localDate('2026-11-04'), weights }, T0)
}

/** Logs every set still open, in order, at the target. */
function logAll(lifts: LiveLifts): LiveLifts {
  let next = lifts
  for (let c = currentSet(next); c; c = currentSet(next)) next = logSet(next, c.exercise, c.set, T0)
  return next
}

describe('startLifts', () => {
  it('prefills each set with the Working weight, the target reps and the target RPE', () => {
    const lifts = start(3)
    expect(lifts.heading).toBe('Strength, squat 3 × 5')
    expect(lifts.exercises.map((e) => [e.name, e.sets, e.repsWords, e.rpeWords, e.restSeconds, e.calibrate])).toEqual([
      ['Back squat', 3, '5', 'RPE 7', 120, false],
      ['Romanian deadlift', 3, '6', 'RPE 7', 90, false],
      ['Bulgarian split squat', 2, '6 / leg', 'RPE 7', 60, false],
      ['Single-leg calf raise', 3, '8 / leg', null, 60, false],
      ['Loaded seated calf raise', 2, '10', null, 60, false],
      ['Pull-ups and push-ups', 2, '6–10 each', null, 60, false],
    ])
    expect(lifts.sets.map((sets) => sets[0])).toEqual([
      { pounds: 185, reps: 5, rpe: 7, done: false },
      { pounds: 135, reps: 6, rpe: 7, done: false },
      { pounds: 30, reps: 6, rpe: 7, done: false },
      { pounds: 35, reps: 8, rpe: 7, done: false },
      { pounds: 65, reps: 10, rpe: 7, done: false },
      { pounds: null, reps: 6, rpe: 7, done: false },
    ])
    expect(currentSet(lifts)).toEqual({ exercise: 0, set: 0 })
  })

  it('makes Week 1 a calibration: ramp from an empty bar to RPE 7', () => {
    const lifts = start(1, {})
    expect(lifts.exercises[0]).toMatchObject({ calibrate: true, rpe: 7, rpeWords: 'ramp to RPE 7' })
    expect(lifts.sets[0][0]).toMatchObject({ pounds: 45, rpe: 7 })
  })

  it('calibrates any lift with no Working weight yet', () => {
    const lifts = start(3, { 'back-squat': 185 })
    expect(lifts.exercises.map((e) => e.calibrate)).toEqual([false, true, true, true, true, false])
  })

  it('follows the Deload pattern: two sets of the main lifts at about 85–90%, RPE 6 at most', () => {
    const lifts = start(4)
    expect(lifts.exercises.slice(0, 2).map((e) => [e.sets, e.rpeWords])).toEqual([
      [2, 'RPE ≤ 6'],
      [2, 'RPE ≤ 6'],
    ])
    expect(lifts.sets[0][0]).toMatchObject({ pounds: 160, rpe: 6 })
  })

  it('follows the maintenance pattern from Week 15: 2 × 4 at RPE 7–8', () => {
    const lifts = start(15)
    expect(lifts.exercises.slice(0, 2).map((e) => [e.sets, e.repsWords, e.rpeWords])).toEqual([
      [2, '4', 'RPE 7–8'],
      [2, '4', 'RPE 7–8'],
    ])
  })
})

describe('logging sets', () => {
  it('logs a set and starts the rest timer, which counts down from the timestamp', () => {
    const lifts = logSet(start(3), 0, 0, at(0))
    expect(lifts.sets[0][0].done).toBe(true)
    expect(currentSet(lifts)).toEqual({ exercise: 0, set: 1 })
    expect(restLeft(lifts, at(30))).toBe(90)
    expect(restLeft(lifts, at(500))).toBe(0)
    expect(restLeft(endRest(lifts), at(30))).toBeNull()
  })

  it('moves later sets with a load step, but never a logged one', () => {
    let lifts = logSet(start(3), 0, 0, at(0))
    lifts = setLoad(lifts, 0, 1, 190)
    expect(lifts.sets[0].map((s) => s.pounds)).toEqual([185, 190, 190])
    lifts = setLoad(lifts, 0, 0, 200)
    expect(lifts.sets[0][0].pounds).toBe(185)
  })

  it('keeps every load on a 5 lb step and never below zero', () => {
    expect(setLoad(start(3), 0, 0, 187).sets[0][0].pounds).toBe(185)
    expect(setLoad(start(3), 0, 0, -10).sets[0][0].pounds).toBe(0)
  })

  it('takes an RPE and the reps actually done for any set', () => {
    let lifts = logSet(start(3), 0, 0, at(0))
    lifts = setRpe(setReps(lifts, 0, 0, 4), 0, 0, 9)
    expect(lifts.sets[0][0]).toMatchObject({ reps: 4, rpe: 9 })
    expect(setRpe(lifts, 0, 0, 11)).toBe(lifts)
  })

  it('adds ramp sets to a calibration only', () => {
    const calibration = addSet(start(1, {}), 0)
    expect(calibration.sets[0]).toHaveLength(4)
    const normal = start(3)
    expect(addSet(normal, 0)).toBe(normal)
  })

  it('starts no rest after the last set', () => {
    expect(logAll(start(3)).rest).toBeNull()
  })

  it('opens the finish sheet on Finish, and closes it on Keep going', () => {
    const lifts = finish(logSet(start(3), 0, 0, at(0)))
    expect(lifts).toMatchObject({ ending: true, rest: null })
    expect(keepGoing(lifts).ending).toBe(false)
  })
})

describe('liftsLog', () => {
  const input = { id: 'lift-1234', rpe: 7, updatedAt: '2026-11-04T18:00:00.000Z' }

  it('logs every set, Done when every prescribed set is in', () => {
    let lifts = logSet(start(3), 0, 0, at(0))
    lifts = setLoad(lifts, 0, 1, 190)
    lifts = logAll(setRpe(lifts, 0, 0, 8))
    const log = liftsLog(lifts, T0 + 50 * 60_000, input)
    expect(log).toMatchObject({ week: 3, sessionId: 'strength', status: 'done', minutes: 50, rpe: 7, environment: null })
    expect(log.sets.slice(0, 3)).toEqual([
      { exercise: 0, set: 1, lift: 'back-squat', pounds: 185, reps: 5, rpe: 8 },
      { exercise: 0, set: 2, lift: 'back-squat', pounds: 190, reps: 5, rpe: 7 },
      { exercise: 0, set: 3, lift: 'back-squat', pounds: 190, reps: 5, rpe: 7 },
    ])
    expect(log.sets.at(-1)).toEqual({ exercise: 5, set: 2, lift: null, pounds: null, reps: 6, rpe: 7 })
    expect(parseSessionLog(log)).toEqual(log)
  })

  it('is Partial when a set the Program asks for was never logged', () => {
    const lifts = finish(logSet(start(3), 0, 0, at(0)))
    expect(liftsStatus(lifts)).toBe('partial')
    expect(liftsLog(lifts, at(600), input).sets).toHaveLength(1)
  })
})

describe('parseLiveLifts', () => {
  it('reads back what was stored, and drops anything else', () => {
    const lifts = logSet(start(3), 0, 0, at(0))
    expect(parseLiveLifts(JSON.parse(JSON.stringify(lifts)))).toEqual(lifts)
    expect(parseLiveLifts({ ...lifts, type: 'speed' })).toBeNull()
    expect(parseLiveLifts({ ...lifts, sets: [] })).toBeNull()
    expect(parseLiveLifts(null)).toBeNull()
  })
})
