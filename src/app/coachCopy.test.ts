import { describe, expect, it } from 'vitest'
import { localDate } from '../domain/calendar'
import { findWeek } from '../domain/coach'
import { program } from '../domain/program/program'
import type { Suggestion, WorkingWeightSuggestion } from '../domain/suggestion'
import type { SessionLog } from '../domain/log'
import type { ProgramRecap } from '../domain/recap'
import { droppedLine, raceCopy, suggestedRestCopy, suggestionCopy, waitingLine } from './coachCopy'

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
        { date: localDate('2026-11-23'), painScore: 3 },
        { date: localDate('2026-11-24'), painScore: 4 },
        { date: localDate('2026-11-25'), painScore: 5 },
      ],
    },
    decision: 'open',
    decidedOn: null,
  }

  it('says the change and the three flags behind it', () => {
    const copy = suggestionCopy(lighter)
    expect(copy.line).toBe('Three rough days this Week. That’s your body asking for a Deload. The rest of Week 3 goes 33% lighter.')
    expect(copy.why).toBe('Mon pain 3 · Tue pain 4 · Wed pain 5 · every Prescription left in Week 3 at 67%')
    expect(copy.keep).toBe('Keep full volume')
  })
})

describe('a Working weight Suggestion quotes the load that was lifted', () => {
  const squat = (reason: WorkingWeightSuggestion['trigger']['reason'], to: number, pounds: number, topRpe: number): WorkingWeightSuggestion => ({
    id: 'ww-back-squat-w2',
    kind: 'working-weight',
    week: 2,
    sessionId: 'strength',
    lift: 'back-squat',
    date: localDate('2026-11-18'),
    from: { pounds: 185 },
    to: { pounds: to },
    trigger: { reason, weeks: [2], sets: 3, reps: 5, pounds, topRpe },
    decision: 'open',
    decidedOn: null,
  })

  it('an increase from sets done over the Working weight', () => {
    const copy = suggestionCopy(squat('all-reps-easy', 205, 200, 7))
    expect(copy.line).toBe('Squat: every rep, nothing harder than RPE 7. 200 lb was a warm-up. 205 lb next time.')
    expect(copy.why).toBe('Week 2: 3 × 5 at 200 lb, top RPE 7 · +20 lb')
  })

  it('sets lifted heavier than written', () => {
    const copy = suggestionCopy(squat('lifted-heavier', 200, 200, 8))
    expect(copy.line).toBe('Squat: I wrote 185 lb. You lifted 200 lb, every rep. 200 lb it is.')
    expect(copy.why).toBe('Week 2: 3 × 5 at 200 lb, top RPE 8 · +15 lb')
    expect(copy.keep).toBe('Keep 185 lb')
  })
})
