import { describe, expect, it } from 'vitest'
import { localDate } from '../domain/calendar'
import { findWeek } from '../domain/coach'
import { startRun } from '../domain/live'
import { program } from '../domain/program/program'
import { liveLine, tankLine, tankWords } from './liveCopy'

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

describe('liveLine', () => {
  const lines = (week: number, id: string) => {
    const session = findWeek(program, week)!.sessions.find((s) => s.id === id)!
    const run = startRun({ week, session, date: localDate('2026-11-11'), environment: 'indoor' }, 0)
    return run.blocks.slice(0, 3).map((b) => liveLine(b, run))
  }

  it('has a line for each part of a split warm-up, and for Set up', () => {
    expect(lines(3, 'speed').slice(0, 2)).toEqual(['Warm-up. Easy. Nobody is watching.', 'Drills. Sharp, not tired.'])
    expect(lines(2, '5k-test')[1]).toBe('Quick and relaxed. Not a sprint.')
    expect(lines(3, 'hyrox')).toEqual([
      'Warm-up. Easy. Nobody is watching.',
      'Lunges. Wake the legs up, don’t tire them.',
      'Load every Station now. This clock isn’t training. Tap Done when it’s all set.',
    ])
  })
})
