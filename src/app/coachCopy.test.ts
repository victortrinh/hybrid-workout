import { describe, expect, it } from 'vitest'
import { localDate } from '../domain/calendar'
import { findWeek } from '../domain/coach'
import { program } from '../domain/program/program'
import { waitingLine } from './coachCopy'

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
