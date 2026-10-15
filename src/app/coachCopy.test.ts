import { describe, expect, it } from 'vitest'
import { localDate } from '../domain/calendar'
import { findWeek } from '../domain/coach'
import { program } from '../domain/program/program'
import type { ShortSleepCut } from '../domain/recovery'
import type { RecoverySuggestion } from '../domain/suggestion'
import { shortSleepLine, suggestionCopy, waitingLine } from './coachCopy'

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
