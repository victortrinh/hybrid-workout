import { describe, expect, it } from 'vitest'
import { localDate } from '../domain/calendar'
import { findWeek } from '../domain/coach'
import { program } from '../domain/program/program'
import type { ShortSleepCut } from '../domain/recovery'
import type { RecoverySuggestion } from '../domain/suggestion'
import type { SessionLog } from '../domain/log'
import type { ProgramRecap } from '../domain/recap'
import { raceCopy, shortSleepLine, suggestionCopy, waitingLine } from './coachCopy'

const recovery = (cut: ShortSleepCut | null): RecoverySuggestion => ({
  id: 'recovery-2026-11-04',
  kind: 'recovery',
  week: 3,
  sessionId: 'hyrox',
  date: localDate('2026-11-04'),
  cut,
  trigger: { sleepMinutes: 320, hrvMs: 40, hrvMean: 52 },
  decision: 'open',
  decidedOn: null,
})

describe('the short-sleep copy names what is cut', () => {
  const cases: [ShortSleepCut, string][] = [
    ['rep', 'rep'],
    ['round', 'round'],
    ['station', 'Station'],
    ['set', 'set'],
  ]

  it.each(cases)('%s: the line', (cut, noun) => {
    expect(shortSleepLine(320, cut)).toBe(`Slept 5 h 20. Bold of you. One fewer ${noun}, nothing past RPE 7.`)
  })

  it.each(cases)('%s: Keep and kept', (cut, noun) => {
    const copy = suggestionCopy(recovery(cut))
    expect(copy.keep).toBe(`Keep it, one ${noun} fewer`)
    expect(copy.kept).toBe(`Keeping it. One ${noun} fewer, nothing past RPE 7. Your call.`)
  })

  it('says only the cap when nothing is cut', () => {
    expect(shortSleepLine(320, null)).toBe('Slept 5 h 20. Bold of you. Nothing past RPE 7.')
    const copy = suggestionCopy(recovery(null))
    expect(copy.keep).toBe('Keep it, capped at RPE 7')
    expect(copy.kept).toBe('Keeping it. Nothing past RPE 7. Your call.')
  })

  it('never says rep on a HYROX session', () => {
    const copy = suggestionCopy(recovery('round'))
    expect(`${shortSleepLine(320, 'round')} ${copy.keep} ${copy.kept}`).not.toMatch(/\brep\b/)
  })
})

const race = findWeek(program, 27)!.sessions.find((s) => s.id === 'race')!
const shakeout = findWeek(program, 27)!.sessions.find((s) => s.id === 'shakeout')!

describe('waitingLine', () => {
  it('says tomorrow the day before the race', () => {
    expect(waitingLine(race, localDate('2027-04-21'), localDate('2027-04-20'))).toBe('The race is tomorrow. Save it for that.')
  })

  it('names the weekday further out', () => {
    expect(waitingLine(race, localDate('2027-04-21'), localDate('2027-04-19'))).toBe('The race is Wednesday. Save it for that.')
  })

  it('uses the Session’s heading for any other pinned Session', () => {
    const pinned = { ...shakeout, date: localDate('2027-04-20') }
    expect(waitingLine(pinned, localDate('2027-04-20'), localDate('2027-04-19'))).toMatch(/^\S.* is tomorrow\. Save it for that\.$/)
  })
})

describe('the Coach after Race day', () => {
  const recap = (fiveK: ProgramRecap['fiveK']): ProgramRecap => ({
    fiveK,
    workingWeights: [],
    sessions: { done: 108, required: 110, easy: 13 },
    trainingLoad: { total: 48210, byLane: {} },
  })
  const race = { id: 'r' } as SessionLog
  const sub20 = { first: { week: 2, seconds: 1380 }, last: { week: 25, seconds: 1195 }, sub20: true }

  it('asks for the finish time, one number', () => {
    expect(raceCopy({ state: 'ask', log: null }, recap(sub20))).toEqual({
      heading: 'Race done. How fast?',
      target: 'The finish time off the results page. One number, then the recap.',
    })
  })

  it('calls both goals when the last 5K test was sub-20', () => {
    expect(raceCopy({ state: 'finished', log: race, seconds: 5047 }, recap(sub20))).toEqual({
      heading: 'Program done.',
      target: 'Sub-20 on the 5K, 1:24:07 at HYROX. Both goals, one Program. Now sit down for a week.',
    })
  })

  it('says how far the 5K came when it wasn’t sub-20, without dressing it up', () => {
    const close = { first: { week: 2, seconds: 1380 }, last: { week: 25, seconds: 1210 }, sub20: false }
    expect(raceCopy({ state: 'finished', log: race, seconds: 5047 }, recap(close)).target).toBe(
      '1:24:07 at HYROX, and 2:50 off the 5K to 20:10. Not sub-20. Not nothing either.',
    )
  })

  it('leans on the Sessions without a 5K test', () => {
    expect(raceCopy({ state: 'finished', log: race, seconds: 5047 }, recap(null)).target).toBe(
      '1:24:07 at HYROX, on 108 Sessions. Now sit down for a week.',
    )
  })

  it('doesn’t ask after a Skipped race', () => {
    expect(raceCopy({ state: 'skipped', log: race }, recap(sub20))).toEqual({
      heading: 'Program done.',
      target: 'Race Skipped. The 27 Weeks still happened, and these are their numbers.',
    })
  })
})
