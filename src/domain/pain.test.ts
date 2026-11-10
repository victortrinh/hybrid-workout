import { describe, expect, it } from 'vitest'
import { localDate } from './calendar'
import { mergePainReports, painAdapted, painLevel, parsePainReport, type PainReport } from './pain'
import { program } from './program/program'
import type { Block, Exercise, Session } from './program/types'

const report: PainReport = {
  id: '0f8c2b1e-7a4d-4c3e-9b2a-1d5e6f7a8b9c',
  date: localDate('2026-11-11'),
  score: 4,
  area: 'achilles-calf',
  week: 1,
  sessionId: 'run',
  updatedAt: '2026-11-11T12:00:00.000Z',
}

describe('painLevel', () => {
  it('follows the thresholds: 3 eases, 5 goes low-impact', () => {
    expect([0, 1, 2, 3, 4, 5, 6, 10].map((score) => painLevel(score, null))).toEqual([
      null,
      null,
      null,
      'ease',
      'ease',
      'low-impact',
      'low-impact',
      'low-impact',
    ])
  })

  it('eases for rising pain, higher than the report before', () => {
    expect(painLevel(2, 1)).toBe('ease')
    expect(painLevel(1, 0)).toBe('ease')
    expect(painLevel(2, 2)).toBeNull()
    expect(painLevel(0, 0)).toBeNull()
    expect(painLevel(6, 2)).toBe('low-impact')
  })
})

describe('parsePainReport', () => {
  it('takes a clean report, and a No with no area or Session', () => {
    expect(parsePainReport(report)).toEqual(report)
    const no = { ...report, score: 0, area: null, week: null, sessionId: null }
    expect(parsePainReport(no)).toEqual(no)
    expect(parsePainReport({ ...no, area: undefined, week: undefined, sessionId: undefined })).toEqual(no)
  })

  it('refuses anything else', () => {
    const bad: unknown[] = [
      null,
      { ...report, id: 'UPPER-CASE-ID' },
      { ...report, id: 'short' },
      { ...report, date: '2026-02-30' },
      { ...report, score: 11 },
      { ...report, score: -1 },
      { ...report, score: 2.5 },
      { ...report, area: 'elbow' },
      { ...report, area: null },
      { ...report, score: 0 },
      { ...report, week: null },
      { ...report, sessionId: '' },
      { ...report, week: 0 },
      { ...report, updatedAt: '2026-11-11' },
    ]
    for (const value of bad) expect(() => parsePainReport(value)).toThrow()
  })
})

describe('mergePainReports', () => {
  it('keeps every report, and the later edit of one in both', () => {
    const other = { ...report, id: 'another-report-id' }
    const later = { ...report, score: 5, updatedAt: '2026-11-11T13:00:00.000Z' }
    expect(mergePainReports([report], [other, later])).toEqual([later, other])
    expect(mergePainReports([later], [report])).toEqual([later])
  })
})

describe('painAdapted at the ease level: no burpee broad jumps or sled push, fewer interval reps', () => {
  const sessions = program.phases
    .flatMap((p) => p.weeks)
    .flatMap((w) => w.sessions)
    .filter((s) => !s.date)
  const stationIds = (b: Block) => b.exercises.flatMap((e) => (e.prescription.kind === 'station' ? [e.prescription.station] : []))
  const IMPACT = ['burpee-broad-jumps', 'sled-push']
  const withImpact = sessions.filter((s) => s.blocks.some((b) => stationIds(b).some((id) => IMPACT.includes(id))))
  const week = (n: number) => program.phases.flatMap((p) => p.weeks).find((w) => w.number === n)!
  const mainBlocks = (s: Session) => s.blocks.filter((b) => b.main)

  it('takes burpee broad jumps and sled push out of every Session that has them, Set up included', () => {
    expect(new Set(withImpact.map((s) => s.type))).toEqual(new Set(['hyrox', 'race-simulation', 'compromised-run-test']))
    for (const s of withImpact) {
      expect(painAdapted(s, 'ease').blocks.flatMap(stationIds).filter((id) => IMPACT.includes(id))).toEqual([])
    }
  })

  it('puts the SkiErg in for burpee broad jumps, for about the same time, with the reason', () => {
    const hyroxB = week(1).sessions.find((s) => s.id === 'hyrox-b')!
    const eased = painAdapted(hyroxB, 'ease')
    const round2 = eased.blocks.find((b) => b.name === 'Round 2')!
    expect(round2.exercises.map(describeLeg)).toEqual(['SkiErg 250 m: Instead of burpee broad jumps: pain says no impact.', 'Run'])
    expect(eased.headline).toBe('8 rounds')
    expect(eased.minutes).toBe(hyroxB.minutes)
  })

  it('puts the row in for sled push, for about the same time, and takes the sled out of the Set up', () => {
    const hyroxA = week(1).sessions.find((s) => s.id === 'hyrox-a')!
    const eased = painAdapted(hyroxA, 'ease')
    expect(eased.blocks.find((b) => b.name === 'Round 1')!.exercises.map(describeLeg)).toEqual([
      'Row 500 m: Instead of sled push: pain says no impact.',
      'Run',
    ])
    expect(eased.blocks.find((b) => b.setup)!.exercises.map((e) => e.name)).toEqual(['Sled pull', 'Farmers carry', 'Sandbag lunges'])
    // Race volume: 50 m of sled push is 1000 m of row.
    const sim = sessions.find((s) => s.type === 'race-simulation' && s.headline === 'half A')!
    const leg = painAdapted(sim, 'ease').blocks.find((b) => b.exercises.some((e) => /sled push/.test(e.note ?? '')))!
    expect(leg.exercises.map(describeLeg)).toContain('Row 1000 m: Instead of sled push: pain says no impact.')
  })

  it('leaves the other Stations, and sandbag lunges, as written', () => {
    for (const s of sessions) {
      const others = (x: Session) =>
        x.blocks.flatMap((b) => b.exercises).filter((e) => e.prescription.kind !== 'station' || !IMPACT.includes(e.prescription.station))
      const kept = painAdapted(s, 'ease').blocks.flatMap((b) => b.exercises).filter((e) => !/^Instead of/.test(e.note ?? ''))
      expect(kept.filter((e) => /lunge/i.test(e.name))).toEqual(others(s).filter((e) => /lunge/i.test(e.name)))
    }
  })

  it('cuts Threshold reps by about 30%, and the minutes with them', () => {
    const run = week(3).sessions.find((s) => s.id === 'run')!
    expect(run.headline).toBe('3 × 8′')
    const eased = painAdapted(run, 'ease')
    expect(eased.headline).toBe('2 × 8′')
    expect(eased.minutes).toBeLessThan(run.minutes)
    expect(mainBlocks(eased)[0].exercises[0].prescription).toMatchObject({ kind: 'intervals', reps: 2 })
  })

  it('cuts Compromised intervals by about 30% too: a rep is a 1 km and its wall balls', () => {
    const run = week(6).sessions.find((s) => s.id === 'run')!
    expect(run.headline).toBe('4 × (1 km + 20 wall balls)')
    const eased = painAdapted(run, 'ease')
    expect(eased.headline).toBe('3 × (1 km + 20 wall balls)')
    expect(mainBlocks(eased).map((b) => b.name)).toEqual(['Rep 1', 'Rep 2', 'Rep 3'])
    expect(mainBlocks(eased).at(-1)!.note).toBeUndefined()
    expect(eased.minutes).toBe(run.minutes - mainBlocks(run)[3].minutes!)
    const five = week(11).sessions.find((s) => s.id === 'run')!
    expect(painAdapted(five, 'ease').headline).toBe('4 × (1 km + 20 wall balls)')
  })

  it('leaves HYROX rounds and an Easy run whole', () => {
    const easy = week(3).sessions.find((s) => s.id === 'easy')!
    expect(painAdapted(easy, 'ease')).toEqual(easy)
    const hyroxB = week(3).sessions.find((s) => s.id === 'hyrox-b')!
    expect(mainBlocks(painAdapted(hyroxB, 'ease'))).toHaveLength(8)
  })

  it('keeps the old jump and acceleration Substitutions gone: nothing goes to the bike', () => {
    for (const s of sessions) {
      const names = painAdapted(s, 'ease').blocks.flatMap((b) => b.exercises.map((e) => e.name))
      expect(names.filter((n) => /bike/i.test(n))).toEqual(s.blocks.flatMap((b) => b.exercises.map((e) => e.name)).filter((n) => /bike/i.test(n)))
      for (const e of s.blocks.flatMap((b) => b.exercises)) {
        expect((e.substitutions ?? []).flatMap((x) => x.when)).not.toContain('readiness')
      }
    }
  })

  it('makes the Session easy low-impact work or rest at pain 5 or more', () => {
    const hyroxA = week(3).sessions.find((s) => s.id === 'hyrox-a')!
    expect(painAdapted(hyroxA, 'low-impact')).toMatchObject({ headline: 'easy bike 30′ or rest', minutes: 30 })
  })
})

function describeLeg({ name, prescription: rx, note }: Exercise): string {
  const amount = rx.kind === 'station' && rx.meters ? ` ${rx.meters} m` : ''
  return `${name}${amount}${note ? `: ${note}` : ''}`
}
