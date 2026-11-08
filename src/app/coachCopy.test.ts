import { describe, expect, it } from 'vitest'
import { localDate } from '../domain/calendar'
import { findWeek } from '../domain/coach'
import { program } from '../domain/program/program'
import type { ShortSleepCut } from '../domain/recovery'
import type { RecoverySuggestion, Suggestion } from '../domain/suggestion'
import type { SessionLog } from '../domain/log'
import type { ProgramRecap } from '../domain/recap'
import { droppedLine, raceCopy, shortSleepLine, suggestedRestCopy, suggestionCopy, waitingLine } from './coachCopy'

const recovery = (cut: ShortSleepCut | null): RecoverySuggestion => ({
  id: 'recovery-2026-11-11',
  kind: 'recovery',
  week: 3,
  sessionId: 'hyrox-a',
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

const race = findWeek(program, 24)!.sessions.find((s) => s.id === 'race')!
const shakeout = findWeek(program, 24)!.sessions.find((s) => s.id === 'shakeout')!

describe('waitingLine', () => {
  it('says tomorrow the day before the race', () => {
    expect(waitingLine(race, localDate('2027-04-22'), localDate('2027-04-21'))).toBe('The race is tomorrow. Save it for that.')
  })

  it('names the weekday further out', () => {
    expect(waitingLine(race, localDate('2027-04-22'), localDate('2027-04-19'))).toBe('The race is Thursday. Save it for that.')
  })

  it('uses the Session’s heading for any other pinned Session', () => {
    const pinned = { ...shakeout, date: localDate('2027-04-20') }
    expect(waitingLine(pinned, localDate('2027-04-20'), localDate('2027-04-19'))).toMatch(/^\S.* is tomorrow\. Save it for that\.$/)
  })
})

describe('a rest the spacing rules only suggest', () => {
  const run = findWeek(program, 3)!.sessions.find((s) => s.id === 'run')!

  it('says the rest is suggested, with the reason first', () => {
    expect(suggestedRestCopy({ kind: 'hard-yesterday', anyway: { week: 3, session: run } })).toEqual({
      heading: 'Rest suggested.',
      target: 'Hard session yesterday. The Week has room, so legs up. Your call.',
      meta: 'Run if you go anyway',
    })
  })

  it('gives each spacing rule its reason', () => {
    expect(suggestedRestCopy({ kind: 'hard-today', anyway: { week: 3, session: run } }).target).toMatch(
      /^Hard session already today\./,
    )
    expect(suggestedRestCopy({ kind: 'run-after-load', anyway: { week: 3, session: run } })).toMatchObject({
      heading: 'Rest suggested.',
      target: expect.stringMatching(/^The Run on legs that just lifted\?/),
      meta: 'Run if you go anyway',
    })
  })
})

describe('the Coach after Race day', () => {
  const recap = (raceRun: ProgramRecap['raceRun']): ProgramRecap => ({
    raceRun,
    workingWeights: [],
    sessions: { done: 108, required: 110, easy: 13 },
    trainingLoad: { total: 48210, byLane: {} },
  })
  const race = { id: 'r' } as SessionLog
  const faster = { first: { week: 2, secondsPerKm: 313 }, last: { week: 19, secondsPerKm: 291 } }

  it('asks for the finish time, one number', () => {
    expect(raceCopy({ state: 'ask', log: null }, recap(faster))).toEqual({
      heading: 'Race done. How fast?',
      target: 'The finish time off the results page. One number, then the recap.',
    })
  })

  it('says how far the Race run pace came', () => {
    expect(raceCopy({ state: 'finished', log: race, seconds: 5047 }, recap(faster))).toEqual({
      heading: 'Program done.',
      target: '1:24:07 at HYROX, on a Race run pace 22 s/km quicker than Week 2’s. Now sit down for a week.',
    })
  })

  it('leans on the Sessions when the Race run pace didn’t come down, or was never tested', () => {
    const flat = { first: { week: 2, secondsPerKm: 300 }, last: { week: 19, secondsPerKm: 300 } }
    for (const raceRun of [flat, null]) {
      expect(raceCopy({ state: 'finished', log: race, seconds: 5047 }, recap(raceRun)).target).toBe(
        '1:24:07 at HYROX, on 108 Sessions. Now sit down for a week.',
      )
    }
  })

  it('doesn’t ask after a Skipped race', () => {
    expect(raceCopy({ state: 'skipped', log: race }, recap(faster))).toEqual({
      heading: 'Program done.',
      target: 'Race Skipped. The 24 Weeks still happened, and these are their numbers.',
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
    expect(droppedLine(dropped(3, 13, 14))).toBe('3 Sessions from Weeks 13–14 dropped to keep Race specific on schedule.')
  })

  it('names the one Week, and says Session for one', () => {
    expect(droppedLine(dropped(2, 15, 15))).toBe('2 Sessions from Week 15 dropped to keep Race specific on schedule.')
    expect(droppedLine(dropped(1, 15, 15))).toBe('1 Session from Week 15 dropped to keep Race specific on schedule.')
  })
})

describe('the lighter-Week Suggestion’s copy', () => {
  const lighter: Suggestion = {
    id: 'lighter-week-w3',
    kind: 'lighter-week',
    week: 3,
    sessionId: null,
    date: localDate('2026-11-25'),
    from: { volumePercent: 100 },
    to: { volumePercent: 67 },
    trigger: {
      flags: [
        { date: localDate('2026-11-23'), painScore: 3, sleepMinutes: null },
        { date: localDate('2026-11-24'), painScore: null, sleepMinutes: 320 },
        { date: localDate('2026-11-25'), painScore: 4, sleepMinutes: 341 },
      ],
    },
    decision: 'open',
    decidedOn: null,
  }

  it('says the change and the three flags behind it', () => {
    const copy = suggestionCopy(lighter)
    expect(copy.line).toBe('Three rough days this Week. That’s your body asking for a Deload. The rest of Week 3 goes 33% lighter.')
    expect(copy.why).toBe('Mon pain 3 · Tue slept 5 h 20 · Wed pain 4, slept 5 h 41 · every Prescription left in Week 3 at 67%')
    expect(copy.keep).toBe('Keep full volume')
  })
})
