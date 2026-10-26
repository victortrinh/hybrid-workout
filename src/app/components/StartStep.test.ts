import { describe, expect, it } from 'vitest'
import { localDate } from '../../domain/calendar'
import { findWeek } from '../../domain/coach'
import type { PainReport } from '../../domain/pain'
import { program } from '../../domain/program/program'
import { asksAtStart, asksWhere } from './StartStep'

const session = (week: number, id: string) => findWeek(program, week)!.sessions.find((s) => s.id === id)!

const ACHILLES_3: PainReport = {
  id: 'r1',
  date: localDate('2026-10-21'),
  score: 3,
  area: 'achilles-calf',
  week: null,
  sessionId: null,
  updatedAt: '2026-10-21T12:00:00.000Z',
}

describe('asksWhere', () => {
  it('asks Treadmill or outside for a Speed, Threshold, Easy run or 5K test', () => {
    for (const [week, id] of [[3, 'speed'], [3, 'threshold'], [3, 'easy'], [2, '5k-test']] as const) {
      expect(asksWhere(session(week, id)), id).toBe(true)
    }
  })

  it('starts Strength, HYROX and a Race simulation as before', () => {
    const simulation = program.phases
      .flatMap((p) => p.weeks)
      .flatMap((w) => w.sessions)
      .find((s) => s.type === 'race-simulation')!
    for (const s of [session(3, 'strength'), session(3, 'hyrox'), simulation]) {
      expect(asksWhere(s), s.id).toBe(false)
    }
  })
})

describe('asksAtStart', () => {
  it('asks a run even with nothing hurting, and Strength only when pain stands', () => {
    expect(asksAtStart(session(3, 'speed'), null)).toBe(true)
    expect(asksAtStart(session(3, 'strength'), null)).toBe(false)
    expect(asksAtStart(session(3, 'strength'), { ...ACHILLES_3, score: 0 })).toBe(false)
    expect(asksAtStart(session(3, 'strength'), ACHILLES_3)).toBe(true)
  })
})
