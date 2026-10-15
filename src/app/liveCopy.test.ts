import { describe, expect, it } from 'vitest'
import { tankLine, tankWords } from './liveCopy'

describe('tankWords', () => {
  it('reads reps in reserve as 10 minus RPE', () => {
    expect(tankWords(7)).toBe('three left')
    expect(tankWords(8)).toBe('two left')
    expect(tankWords(9)).toBe('one left')
  })
  it('spans a range, easiest end first', () => {
    expect(tankWords(5, 7)).toBe('three to five left')
    expect(tankWords(9, 10)).toBe('none to one left')
  })
  it('says nothing left at RPE 10', () => {
    expect(tankWords(10)).toBe('nothing left')
  })
})

describe('tankLine', () => {
  it('names the target', () => {
    expect(tankLine(5, 7)).toBe('RPE 5–7: three to five left in the tank')
    expect(tankLine(8)).toBe('RPE 8: two left in the tank')
    expect(tankLine(7)).toBe('RPE 7: three left in the tank')
    expect(tankLine(10)).toBe('RPE 10: nothing left')
  })
})
