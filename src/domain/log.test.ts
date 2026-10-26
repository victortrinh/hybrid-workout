import { describe, expect, it } from 'vitest'
import { localDate } from './calendar'
import { logDays, logFor, mergeLogs, missingRequired, parseSessionLog, type SessionLog } from './log'

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
  distanceMeters: null,
  recoveryPace: null,
  intervals: [],
  sets: [],
  stations: [],
  updatedAt: '2026-11-04T17:00:00.000Z',
}

const held = { block: 1, rep: 1, targetPace: 292, held: true, actualPace: null }
const changed = { block: 3, rep: 2, targetPace: 292, held: false, actualPace: 298 }
const round = { round: 1, part: 'round', pounds: null, meters: null, reps: null, seconds: 600 }
const sled = { round: 1, part: 'sled-push', pounds: 0, meters: 25, reps: null, seconds: null }

const squat = { exercise: 0, set: 1, lift: 'back-squat', pounds: 185, reps: 5, rpe: 7 }
const pullUps = { exercise: 5, set: 1, lift: null, pounds: null, reps: 8, rpe: 7 }

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

  it('accepts a Live session’s console distance and reps, and treats missing ones as none', () => {
    const live = { ...valid, environment: 'indoor', distanceMeters: 9400, intervals: [held, changed] }
    expect(parseSessionLog(live)).toEqual(live)
    const { distanceMeters, intervals, ...older } = valid
    expect(parseSessionLog(older)).toMatchObject({ distanceMeters: null, intervals: [] })
  })

  it('accepts by-feel speeds: a rep’s actual pace with no target, and the jogs’ recovery pace', () => {
    const rep = { block: 4, rep: 1, targetPace: null, held: false, actualPace: 257 }
    const byFeel = { ...valid, sessionId: 'speed', environment: 'indoor', recoveryPace: 600, intervals: [rep] }
    expect(parseSessionLog(byFeel)).toEqual(byFeel)
    // Logs saved before by-feel speeds have no recovery pace.
    const { recoveryPace, ...older } = valid
    expect(parseSessionLog(older)).toEqual(valid)
  })

  it('accepts a Strength session’s sets, bodyweight ones included, and treats missing ones as none', () => {
    const strength = { ...valid, sessionId: 'strength', sets: [squat, { ...squat, set: 2 }, pullUps] }
    expect(parseSessionLog(strength)).toEqual(strength)
    const { sets, ...older } = valid
    expect(parseSessionLog(older)).toMatchObject({ sets: [] })
  })

  it('accepts a HYROX session’s Station logs, an empty sled included, and treats missing ones as none', () => {
    const hyrox = { ...valid, sessionId: 'hyrox', stations: [round, sled] }
    expect(parseSessionLog(hyrox)).toEqual(hyrox)
    const { stations, ...older } = valid
    expect(parseSessionLog(older)).toMatchObject({ stations: [] })
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
    ['a result past a 4-hour race', { resultSeconds: 14401 }],
    ['an Environment that is neither', { environment: 'pool' }],
    ['a console distance under 100 m', { distanceMeters: 50 }],
    ['reps that are not a list', { intervals: 'held' }],
    ['a rep logged twice', { intervals: [held, { ...held, rep: 2 }] }],
    ['a held rep with an actual pace', { intervals: [{ ...held, actualPace: 298 }] }],
    ['a changed rep with no actual pace', { intervals: [{ ...changed, actualPace: null }] }],
    ['a rep at 1:00/km', { intervals: [{ ...changed, actualPace: 60 }] }],
    ['sets that are not a list', { sets: 'heavy' }],
    ['a set logged twice', { sets: [squat, squat] }],
    ['a set on a lift that doesn’t exist', { sets: [{ ...squat, lift: 'bench-press' }] }],
    ['a lift with no load', { sets: [{ ...squat, pounds: null }] }],
    ['a load off the 5 lb step', { sets: [{ ...squat, pounds: 187 }] }],
    ['a set with no RPE', { sets: [{ ...squat, rpe: null }] }],
    ['Station logs that are not a list', { stations: 'sled' }],
    ['a Station that is no Station', { stations: [{ ...sled, part: 'tyre-flip' }] }],
    ['a Station logged twice in a round', { stations: [sled, { ...sled, pounds: 90 }] }],
    ['a Station log with no round', { stations: [{ ...sled, round: null }] }],
    ['a load that is not whole pounds', { stations: [{ ...sled, pounds: 202.5 }] }],
    ['a negative split', { stations: [{ ...round, seconds: -1 }] }],
    ['a recovery pace faster than 2:00/km', { recoveryPace: 119 }],
    ['a recovery pace slower than 20:00/km', { recoveryPace: 1201 }],
    ['a recovery pace that is not whole seconds', { recoveryPace: 600.5 }],
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

describe('missingRequired', () => {
  const a = parseSessionLog(valid)
  const week = {
    number: 3,
    sessions: [
      { id: 'threshold', optional: false },
      { id: 'speed', optional: false },
      { id: 'easy', optional: true },
    ],
  }

  it('is true while a required Session has no log', () => {
    expect(missingRequired(week, [a])).toBe(true)
  })

  it('is false once every required Session has a log, Skipped or not, whatever the optional ones', () => {
    const skipped: SessionLog = { ...a, id: 'speed-log', sessionId: 'speed', status: 'skipped' }
    expect(missingRequired(week, [a, skipped])).toBe(false)
  })

  it("ignores another Week's logs", () => {
    const elsewhere: SessionLog = { ...a, id: 'speed-log', sessionId: 'speed', week: 4 }
    expect(missingRequired(week, [a, elsewhere])).toBe(true)
  })
})

describe('logDays', () => {
  const monday = localDate('2026-11-02')
  const sunday = localDate('2026-11-08')
  const week = ['02', '03', '04', '05', '06', '07', '08'].map((d) => `2026-11-${d}`)

  it('offers the Week up to today, and nothing else, inside the Week', () => {
    expect(logDays(monday, sunday, localDate('2026-11-04'))).toEqual({ days: week, outside: null, when: null })
  })

  it('offers today on its own before the Week starts', () => {
    expect(logDays(monday, sunday, localDate('2026-10-14'))).toEqual({ days: week, outside: '2026-10-14', when: 'early' })
  })

  it('offers today as well once the Week is over', () => {
    expect(logDays(monday, sunday, localDate('2026-11-20'))).toEqual({ days: week, outside: '2026-11-20', when: 'late' })
  })

  it('keeps a carried Key session in its window through the carry-over', () => {
    const wednesday = localDate('2026-11-11')
    const days = logDays(monday, wednesday, localDate('2026-11-10'))
    expect(days.days).toHaveLength(10)
    expect(days.when).toBeNull()
    expect(logDays(monday, wednesday, localDate('2026-11-12')).when).toBe('late')
  })
})
