import { describe, expect, it } from 'vitest'
import { localDate } from './calendar'
import { mergePainReports, painLevel, parsePainReport, type PainReport } from './pain'

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
