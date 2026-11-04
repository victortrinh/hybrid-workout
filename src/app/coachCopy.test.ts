import { describe, expect, it } from 'vitest'
import { localDate } from '../domain/calendar'
import { findWeek } from '../domain/coach'
import { program } from '../domain/program/program'
import type { ShortSleepCut } from '../domain/recovery'
import type { RecoverySuggestion } from '../domain/suggestion'
import type { SessionLog } from '../domain/log'
import type { ProgramRecap } from '../domain/recap'
import { droppedLine, raceCopy, shortSleepLine, suggestedRestCopy, suggestionCopy, waitingLine } from './coachCopy'

const recovery = (cut: ShortSleepCut | null): RecoverySuggestion => ({
  id: 'recovery-2026-11-11',
  kind: 'recovery',
  week: 3,
  sessionId: 'hyrox',
  date: localDate('2026-11-11'),
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

const race = findWeek(program, 26)!.sessions.find((s) => s.id === 'race')!
const shakeout = findWeek(program, 26)!.sessions.find((s) => s.id === 'shakeout')!

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

describe('a rest the spacing rules only suggest', () => {
  const threshold = findWeek(program, 3)!.sessions.find((s) => s.id === 'threshold')!
  const speed = findWeek(program, 3)!.sessions.find((s) => s.id === 'speed')!

  it('says the rest is suggested, with the reason first', () => {
    expect(suggestedRestCopy({ kind: 'hard-yesterday', anyway: { week: 3, session: threshold } })).toEqual({
      heading: 'Rest suggested.',
      target: 'Hard session yesterday. The Week has room, so legs up. Your call.',
      meta: 'Threshold if you go anyway',
    })
  })

  it('gives each spacing rule its reason', () => {
    expect(suggestedRestCopy({ kind: 'hard-today', anyway: { week: 3, session: threshold } }).target).toMatch(
      /^Hard session already today\./,
    )
    expect(suggestedRestCopy({ kind: 'speed-after-load', anyway: { week: 3, session: speed } })).toMatchObject({
      heading: 'Rest suggested.',
      target: expect.stringMatching(/^Speed on legs that just lifted or pushed a sled\?/),
      meta: 'Speed if you go anyway',
    })
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
  const underGoal = { first: { week: 2, seconds: 1463 }, last: { week: 24, seconds: 1315 }, underGoal: true }

  it('asks for the finish time, one number', () => {
    expect(raceCopy({ state: 'ask', log: null }, recap(underGoal))).toEqual({
      heading: 'Race done. How fast?',
      target: 'The finish time off the results page. One number, then the recap.',
    })
  })

  it('calls both goals when the last 5K test beat the goal time', () => {
    expect(raceCopy({ state: 'finished', log: race, seconds: 5047 }, recap(underGoal))).toEqual({
      heading: 'Program done.',
      target: 'Under 22:00 on the 5K, 1:24:07 at HYROX. Both goals, one Program. Now sit down for a week.',
    })
  })

  it('says how far the 5K came when it missed the goal time, without dressing it up', () => {
    const close = { first: { week: 2, seconds: 1463 }, last: { week: 24, seconds: 1330 }, underGoal: false }
    expect(raceCopy({ state: 'finished', log: race, seconds: 5047 }, recap(close)).target).toBe(
      '1:24:07 at HYROX, and 2:13 off the 5K to 22:10. Not sub-22. Not nothing either.',
    )
  })

  it('leans on the Sessions without a 5K test', () => {
    expect(raceCopy({ state: 'finished', log: race, seconds: 5047 }, recap(null)).target).toBe(
      '1:24:07 at HYROX, on 108 Sessions. Now sit down for a week.',
    )
  })

  it('doesn’t ask after a Skipped race', () => {
    expect(raceCopy({ state: 'skipped', log: race }, recap(underGoal))).toEqual({
      heading: 'Program done.',
      target: 'Race Skipped. The 26 Weeks still happened, and these are their numbers.',
    })
  })
})

describe('the Sessions dropped as Race specific starts', () => {
  const dropped = (sessions: number, firstWeek: number, lastWeek: number) => ({
    id: 'dropped-race-specific',
    sessions,
    firstWeek,
    lastWeek,
  })

  it('names the range of Weeks they came from', () => {
    expect(droppedLine(dropped(3, 14, 15))).toBe('3 Sessions from Weeks 14–15 dropped to keep Race specific on schedule.')
  })

  it('names the one Week, and says Session for one', () => {
    expect(droppedLine(dropped(2, 21, 21))).toBe('2 Sessions from Week 21 dropped to keep Race specific on schedule.')
    expect(droppedLine(dropped(1, 21, 21))).toBe('1 Session from Week 21 dropped to keep Race specific on schedule.')
  })
})
