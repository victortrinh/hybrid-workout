import { describe, expect, it } from 'vitest'
import { program } from '../domain/program/program'
import type { RacePlan } from '../domain/racePlan'
import { finishClock, raceLoadWords, raceNotes, sourceLine } from './raceCopy'

const { stations } = program

const none: RacePlan = {
  legs: Object.values(stations).map((s) => ({ station: s.id, split: null })),
  run: null,
  finish: null,
  simulations: [],
}

describe('race card copy', () => {
  it('says each Race load the way the race sets it up', () => {
    expect(raceLoadWords(stations.skierg)).toBe('1 km')
    expect(raceLoadWords(stations['sled-push'])).toBe('50 m · 335 lb with the sled')
    expect(raceLoadWords(stations['burpee-broad-jumps'])).toBe('80 m')
    expect(raceLoadWords(stations['farmers-carry'])).toBe('200 m · 2 × 53 lb')
    expect(raceLoadWords(stations['sandbag-lunges'])).toBe('100 m · 44 lb bag')
    expect(raceLoadWords(stations['wall-balls'])).toBe('100 reps · 13 lb ball')
  })

  it('puts the first 1 km 10 s slower than the Race simulation pace', () => {
    const plan = { ...none, run: { secondsPerKm: 285, week: 23 } }
    expect(raceNotes(plan, false, stations['sled-push'])[0]).toMatch(/^First 1 km at 4:55, not 4:45\./)
    expect(raceNotes(none, false, stations['sled-push'])[0]).toMatch(/^First 1 km slower than you want to\./)
  })

  it('says what tonight is for, and what this morning is for', () => {
    expect(raceNotes(none, false, stations['sled-push']).at(-1)).toMatch(/^Tonight/)
    expect(raceNotes(none, true, stations['sled-push']).at(-1)).toMatch(/^Eat 3 hours before/)
  })

  it('names the Race simulations the splits came from, or that there are none', () => {
    expect(sourceLine(none)).toBe('No Race simulation logged, so no splits to go on. Race loads only.')
    expect(sourceLine({ ...none, simulations: [23] })).toBe('Splits from the Race simulation in Week 23.')
    const scaled = { ...none, legs: [{ station: 'skierg' as const, split: { seconds: 240, week: 23, scaled: true } }] }
    expect(sourceLine({ ...scaled, simulations: [17, 20, 23] })).toBe(
      'Splits from the Race simulations in Weeks 17, 20 and 23. Half-volume Stations doubled.',
    )
  })

  it('reads a finish time in hours', () => {
    expect(finishClock(4535)).toBe('1:15:35')
    expect(finishClock(3605)).toBe('1:00:05')
    expect(finishClock(3540)).toBe('59:00')
  })
})
