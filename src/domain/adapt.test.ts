import { describe, expect, it } from 'vitest'
import { lighten, RE_ENTRY_PERCENT } from './adapt'
import { findWeek } from './coach'
import { program } from './program/program'
import type { Prescription, Session } from './program/types'

const session = (week: number, id: string) => findWeek(program, week)!.sessions.find((s) => s.id === id)!
const prescriptions = (s: Session): Prescription[] => s.blocks.flatMap((b) => b.exercises.map((e) => e.prescription))

describe('lighten', () => {
  it('cuts interval reps and minutes by about a third, and says so in the headline', () => {
    const speed = lighten(session(14, 'speed'), RE_ENTRY_PERCENT)
    expect(speed).toMatchObject({ headline: '4 × 2′', minutes: 30 })
    expect(prescriptions(speed)).toContainEqual(expect.objectContaining({ kind: 'intervals', reps: 4, workSeconds: 120 }))
    expect(prescriptions(speed)).toContainEqual(expect.objectContaining({ kind: 'accelerations', reps: 3 }))
  })

  it('keeps intensity as written', () => {
    const [before, after] = [session(14, 'speed'), lighten(session(14, 'speed'), RE_ENTRY_PERCENT)].map(
      (s) => prescriptions(s).find((rx) => rx.kind === 'intervals'),
    )
    expect(after).toMatchObject({ effort: (before as { effort: unknown }).effort })
  })

  it('drops sets, never below one', () => {
    const strength = lighten(session(11, 'strength'), RE_ENTRY_PERCENT)
    const sets = prescriptions(strength).flatMap((rx) => (rx.kind === 'sets' ? [rx.sets] : []))
    expect(sets.every((n) => n >= 1)).toBe(true)
    expect(sets[0]).toBe(2)
  })

  it('shortens runs and Station work to whole steps', () => {
    const hyrox = lighten(session(11, 'hyrox'), RE_ENTRY_PERCENT)
    for (const rx of prescriptions(hyrox)) {
      if (rx.kind === 'run' && rx.meters) expect(rx.meters % 100).toBe(0)
      if (rx.kind === 'station') {
        if (rx.meters) expect(rx.meters % 5).toBe(0)
        if (rx.reps) expect(rx.reps % 5).toBe(0)
      }
    }
    expect(prescriptions(hyrox).find((rx) => rx.kind === 'run' && rx.meters)).toMatchObject({ meters: 500 })
  })

  it('leaves a 5K test and the race whole', () => {
    expect(lighten(session(9, '5k-test'), RE_ENTRY_PERCENT)).toBe(session(9, '5k-test'))
    expect(lighten(session(27, 'race'), RE_ENTRY_PERCENT)).toBe(session(27, 'race'))
  })

  it('leaves the Program untouched', () => {
    const before = JSON.stringify(session(11, 'speed'))
    lighten(session(11, 'speed'), RE_ENTRY_PERCENT)
    expect(JSON.stringify(session(11, 'speed'))).toBe(before)
  })
})
