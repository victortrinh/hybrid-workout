import { describe, expect, it } from 'vitest'
import { lighten, RE_ENTRY_PERCENT } from './adapt'
import { findWeek } from './coach'
import { program } from './program/program'
import type { Prescription, Session } from './program/types'

const session = (week: number, id: string) => findWeek(program, week)!.sessions.find((s) => s.id === id)!
const prescriptions = (s: Session): Prescription[] => s.blocks.flatMap((b) => b.exercises.map((e) => e.prescription))

describe('lighten', () => {
  it('cuts interval reps and minutes by about a third, and says so in the headline', () => {
    const run = lighten(session(12, 'run'), RE_ENTRY_PERCENT)
    expect(run).toMatchObject({ headline: '3 × 7′', minutes: 30 })
    expect(prescriptions(run)).toContainEqual(expect.objectContaining({ kind: 'intervals', reps: 3, workSeconds: 420 }))
  })

  it('keeps intensity as written', () => {
    const [before, after] = [session(12, 'run'), lighten(session(12, 'run'), RE_ENTRY_PERCENT)].map(
      (s) => prescriptions(s).find((rx) => rx.kind === 'intervals'),
    )
    expect(after).toMatchObject({ effort: (before as { effort: unknown }).effort })
  })

  it('drops sets, never below one', () => {
    const strength = lighten(session(7, 'strength'), RE_ENTRY_PERCENT)
    const sets = prescriptions(strength).flatMap((rx) => (rx.kind === 'sets' ? [rx.sets] : []))
    expect(sets.every((n) => n >= 1)).toBe(true)
    expect(sets[0]).toBe(2)
  })

  it('shortens runs and Station work to whole steps', () => {
    const hyrox = lighten(session(7, 'hyrox-a'), RE_ENTRY_PERCENT)
    for (const rx of prescriptions(hyrox)) {
      if (rx.kind === 'run' && rx.meters) expect(rx.meters % 100).toBe(0)
      if (rx.kind === 'station') {
        if (rx.meters) expect(rx.meters % 5).toBe(0)
        if (rx.reps) expect(rx.reps % 5).toBe(0)
      }
    }
    expect(prescriptions(hyrox).find((rx) => rx.kind === 'run' && rx.meters)).toMatchObject({ meters: 400 })
  })

  it('takes the Station targets off with the volume: a target is for the full volume', () => {
    const written = session(7, 'hyrox-a')
    const targeted: Session = {
      ...written,
      blocks: written.blocks.map((b) => ({
        ...b,
        exercises: b.exercises.map((e) =>
          e.prescription.kind === 'station' && b.main ? { ...e, prescription: { ...e.prescription, target: 120 } } : e,
        ),
      })),
    }
    const stationRxs = prescriptions(lighten(targeted, RE_ENTRY_PERCENT)).filter((rx) => rx.kind === 'station')
    expect(stationRxs.length).toBeGreaterThan(0)
    for (const rx of stationRxs) expect(rx).not.toHaveProperty('target')
  })

  it('leaves a Compromised run test and the race whole', () => {
    expect(lighten(session(9, 'compromised-run-test'), RE_ENTRY_PERCENT)).toBe(session(9, 'compromised-run-test'))
    expect(lighten(session(24, 'race'), RE_ENTRY_PERCENT)).toBe(session(24, 'race'))
  })

  it('leaves the Program untouched', () => {
    const before = JSON.stringify(session(7, 'run'))
    lighten(session(7, 'run'), RE_ENTRY_PERCENT)
    expect(JSON.stringify(session(7, 'run'))).toBe(before)
  })
})
