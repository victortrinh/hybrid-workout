import { describe, expect, it } from 'vitest'
import { localDate } from './calendar'
import { mergePainReports, painAdapted, painLevel, parsePainReport, type PainReport } from './pain'
import { program } from './program/program'
import type { Block, Exercise, Session } from './program/types'

const report: PainReport = {
  id: '0f8c2b1e-7a4d-4c3e-9b2a-1d5e6f7a8b9c',
  date: localDate('2026-11-04'),
  score: 4,
  area: 'achilles-calf',
  week: 3,
  sessionId: 'speed',
  updatedAt: '2026-11-04T12:00:00.000Z',
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
      { ...report, updatedAt: '2026-11-04' },
    ]
    for (const value of bad) expect(() => parsePainReport(value)).toThrow()
  })
})

describe('mergePainReports', () => {
  it('keeps every report, and the later edit of one in both', () => {
    const other = { ...report, id: 'another-report-id' }
    const later = { ...report, score: 5, updatedAt: '2026-11-04T13:00:00.000Z' }
    expect(mergePainReports([report], [other, later])).toEqual([later, other])
    expect(mergePainReports([later], [report])).toEqual([later])
  })
})

describe('painAdapted, HYROX at the ease level', () => {
  const sessions = program.phases
    .flatMap((p) => p.weeks)
    .flatMap((w) => w.sessions)
    .filter((s) => (s.type === 'hyrox' || s.type === 'race-simulation') && !s.date)
  const withBurpees = sessions.filter((s) =>
    s.blocks.some((b) => b.exercises.some((e) => e.prescription.kind === 'station' && e.prescription.station === 'burpee-broad-jumps')),
  )
  const stationIds = (b: Block) => b.exercises.flatMap((e) => (e.prescription.kind === 'station' ? [e.prescription.station] : []))

  it('takes Burpee broad jumps out of every HYROX session and Race simulation, Set up included', () => {
    expect(withBurpees.map((s) => s.type)).toEqual(expect.arrayContaining(['hyrox', 'race-simulation']))
    for (const s of withBurpees) {
      expect(painAdapted(s, 'ease').blocks.flatMap(stationIds)).not.toContain('burpee-broad-jumps')
    }
  })

  it('puts SkiErg in their place for about the same time, with the pain note, one SkiErg a round', () => {
    const build = withBurpees.find((s) => s.headline === '3 rounds' && s.blocks.some((b) => b.name === 'Round 3' && stationIds(b).join() === 'skierg'))!
    const eased = painAdapted(build, 'ease')
    const round1 = eased.blocks.find((b) => b.name === 'Round 1')!
    expect(round1.exercises.map((e) => describeLeg(e))).toEqual(['Run', 'SkiErg 1000 m: Plus 500 m instead of burpee broad jumps: pain says no impact.'])
    expect(eased.blocks.find((b) => b.setup)!.exercises.map((e) => e.name)).toEqual(['SkiErg', 'Row', 'Wall balls'])
    for (const s of withBurpees) {
      for (const b of painAdapted(s, 'ease').blocks) expect(new Set(stationIds(b)).size).toBe(stationIds(b).length)
    }
  })

  it('swaps a Race simulation’s Station alone for SkiErg, still a Station', () => {
    const sim = withBurpees.find((s) => s.type === 'race-simulation' && s.headline === 'half A')!
    const leg = painAdapted(sim, 'ease').blocks.find((b) => b.name === 'Run and Station 4')!
    expect(leg.exercises.map(describeLeg)).toEqual(['Run', 'SkiErg 1000 m: Instead of burpee broad jumps: pain says no impact.'])
  })

  it('leaves sandbag lunges and the lunge warm-up as written', () => {
    for (const s of sessions) {
      const names = (x: Session) => x.blocks.flatMap((b) => b.exercises.map((e) => e.name)).filter((n) => /lunge/i.test(n))
      expect(names(painAdapted(s, 'ease'))).toEqual(names(s))
    }
  })
})

function describeLeg({ name, prescription: rx, note }: Exercise): string {
  const amount = rx.kind === 'station' && rx.meters ? ` ${rx.meters} m` : ''
  return `${name}${amount}${note ? `: ${note}` : ''}`
}
