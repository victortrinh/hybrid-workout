import { describe, expect, it } from 'vitest'
import {
  laterStartingPoint,
  parseStartingPoint,
  SKIPPED,
  startingFields,
  startingWeights,
  type StartingPoint,
} from './startingPoint'
import { trainingPaces } from './paces'

const POINT: StartingPoint = {
  splitSeconds: 330,
  weights: { 'back-squat': 225, 'romanian-deadlift': 185 },
  updatedAt: '2026-10-22T12:00:00.000Z',
}

describe('parseStartingPoint', () => {
  it('reads back what was stored', () => {
    expect(parseStartingPoint(POINT)).toEqual(POINT)
    expect(parseStartingPoint({ ...SKIPPED, updatedAt: 'x' })).toEqual({ splitSeconds: null, weights: {}, updatedAt: 'x' })
  })

  it('drops a lift left empty, and refuses anything unbelievable', () => {
    expect(parseStartingPoint({ ...POINT, weights: { 'back-squat': null } }).weights).toEqual({})
    expect(() => parseStartingPoint({ ...POINT, splitSeconds: 60 })).toThrow(/split/)
    expect(() => parseStartingPoint({ ...POINT, splitSeconds: 23 * 60 })).toThrow(/split/)
    expect(() => parseStartingPoint({ ...POINT, weights: { 'back-squat': 2000 } })).toThrow(/back-squat/)
    expect(() => parseStartingPoint({ ...POINT, weights: { 'back-squat': 22.5 } })).toThrow(/back-squat/)
    expect(() => parseStartingPoint({ ...POINT, weights: { 'seated-calf-raise': 50 } })).toThrow(/seated-calf-raise/)
    expect(() => parseStartingPoint({ ...POINT, updatedAt: 3 })).toThrow(/updatedAt/)
    expect(() => parseStartingPoint(null)).toThrow()
  })
})

describe('laterStartingPoint', () => {
  it('keeps the later edit, and either one over none', () => {
    const later = { ...POINT, splitSeconds: 320, updatedAt: '2026-10-23T12:00:00.000Z' }
    expect(laterStartingPoint(POINT, later)).toBe(later)
    expect(laterStartingPoint(later, POINT)).toBe(later)
    expect(laterStartingPoint(null, POINT)).toBe(POINT)
    expect(laterStartingPoint(POINT, null)).toBe(POINT)
    expect(laterStartingPoint(null, null)).toBeNull()
  })
})

describe('startingWeights', () => {
  it('are the estimates of lifts not yet calibrated: a real Working weight wins', () => {
    expect(startingWeights(POINT, { 'back-squat': 190 })).toEqual({ 'romanian-deadlift': 185 })
    expect(startingWeights(null, {})).toEqual({})
  })
})

describe('startingFields', () => {
  it('show the estimates, editable, until a real result replaces each', () => {
    expect(startingFields(POINT, {})).toEqual({
      split: { value: 330, real: false },
      lifts: { 'back-squat': { value: 225, real: false }, 'romanian-deadlift': { value: 185, real: false } },
    })
    expect(startingFields(null, {}).split).toEqual({ value: null, real: false })
  })

  it('show a lift’s real value, read-only, once it is calibrated', () => {
    expect(startingFields(POINT, { 'back-squat': 190 })).toEqual({
      split: { value: 330, real: false },
      lifts: { 'back-squat': { value: 190, real: true }, 'romanian-deadlift': { value: 185, real: false } },
    })
  })

  it('show the split, editable, until a Compromised run test sets the paces: then its Race run pace, read-only', () => {
    expect(startingFields(POINT, {}, trainingPaces(330, { estimate: true })).split).toEqual({ value: 330, real: false })
    expect(startingFields(POINT, {}, trainingPaces(302)).split).toEqual({ value: 302, real: true })
  })
})
