import { describe, expect, it } from 'vitest'
import { logFor, mergeLogs, parseSessionLog, type SessionLog } from './log'

const valid = {
  id: '3f0c9a52-6f1e-4c55-9a6b-0b5f0f2b7e11',
  week: 3,
  sessionId: 'threshold',
  date: '2026-11-04',
  status: 'done',
  minutes: 45,
  rpe: 7,
  notes: 'Held it.',
  resultSeconds: null,
  environment: null,
  updatedAt: '2026-11-04T17:00:00.000Z',
}

describe('parseSessionLog', () => {
  it('accepts a complete log', () => {
    expect(parseSessionLog(valid)).toEqual(valid)
  })

  it('accepts a log with no duration, RPE or notes, and stores blank notes as none', () => {
    const { minutes, rpe, ...rest } = valid
    expect(parseSessionLog({ ...rest, status: 'skipped', notes: '  ' })).toMatchObject({
      minutes: null,
      rpe: null,
      notes: null,
    })
  })

  it('accepts a 5K test result with its Environment, and treats missing ones as none', () => {
    expect(parseSessionLog({ ...valid, sessionId: '5k-test', resultSeconds: 1380, environment: 'indoor' })).toMatchObject({
      resultSeconds: 1380,
      environment: 'indoor',
    })
    const { resultSeconds, environment, ...older } = valid
    expect(parseSessionLog(older)).toMatchObject({ resultSeconds: null, environment: null })
  })

  it.each([
    ['a missing id', { id: undefined }],
    ['a short id', { id: 'abc' }],
    ['Week 0', { week: 0 }],
    ['a fractional Week', { week: 2.5 }],
    ['an empty sessionId', { sessionId: '' }],
    ['a date that is not a calendar date', { date: '2026-02-30' }],
    ['a status of planned', { status: 'planned' }],
    ['RPE 11', { rpe: 11 }],
    ['RPE 0', { rpe: 0 }],
    ['zero minutes', { minutes: 0 }],
    ['notes that are not text', { notes: 42 }],
    ['notes that are too long', { notes: 'x'.repeat(2001) }],
    ['a 5K time under 12 minutes', { resultSeconds: 600 }],
    ['a 5K time that is not whole seconds', { resultSeconds: 1380.5 }],
    ['an Environment that is neither', { environment: 'pool' }],
    ['an updatedAt with a local offset', { updatedAt: '2026-11-04T12:00:00-05:00' }],
  ])('rejects %s', (_, change) => {
    expect(() => parseSessionLog({ ...valid, ...change })).toThrow()
  })

  it('rejects anything that is not an object', () => {
    expect(() => parseSessionLog(null)).toThrow()
    expect(() => parseSessionLog('done')).toThrow()
  })
})

describe('mergeLogs', () => {
  const a = parseSessionLog(valid)
  const later: SessionLog = { ...a, status: 'partial', updatedAt: '2026-11-04T18:00:00.000Z' }
  const other: SessionLog = { ...a, id: 'another-log-id', sessionId: 'speed' }

  it('keeps the later edit of a log present on both sides', () => {
    expect(mergeLogs([a], [later])).toEqual([later])
    expect(mergeLogs([later], [a])).toEqual([later])
  })

  it('keeps logs present on one side only', () => {
    expect(mergeLogs([a], [other])).toEqual([a, other])
  })
})

describe('logFor', () => {
  const a = parseSessionLog(valid)

  it('finds the latest log for a Week and Session, or none', () => {
    const later: SessionLog = { ...a, id: 'second-log-id', updatedAt: '2026-11-05T09:00:00.000Z' }
    expect(logFor([later, a], 3, 'threshold')).toBe(later)
    expect(logFor([a], 3, 'speed')).toBeNull()
    expect(logFor([a], 4, 'threshold')).toBeNull()
  })
})
