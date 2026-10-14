import { describe, expect, it } from 'vitest'
import { isoWeekday, localDate, localDateIn } from './calendar'
import { coach, programStart } from './coach'
import { program } from './program/program'
import type { Program } from './program/types'

const on = (iso: string, p: Program = program) => coach({ program: p, today: localDate(iso) })
/** What the Coach says at an exact instant, read on a clock in Toronto. */
const at = (instant: string) => coach({ program, today: localDateIn(new Date(instant)) })

const weekOf = (day: ReturnType<typeof coach>) =>
  day.position.kind === 'in-week' ? day.position.week : day.position.kind

describe('the Program calendar', () => {
  it('starts Week 1 on Monday 19 October 2026', () => {
    expect(programStart(program)).toBe('2026-10-19')
    expect(isoWeekday(programStart(program))).toBe(1)

    const day = on('2026-10-19')
    expect(day.position).toEqual({
      kind: 'in-week',
      week: 1,
      phase: 'foundation',
      startDate: '2026-10-19',
      endDate: '2026-10-25',
      daysLeft: 7,
    })
  })

  it('puts Race day, Wednesday 21 April 2027, in Week 27', () => {
    expect(isoWeekday(program.raceDay)).toBe(3)
    const day = on('2027-04-21')
    expect(day.position).toMatchObject({ kind: 'in-week', week: 27, phase: 'taper', startDate: '2027-04-19' })
  })

  it('dates every encoded Week to the Monday the calendar gives it', () => {
    for (const phase of program.phases) {
      for (const week of phase.weeks) {
        expect(on(week.startDate).position).toMatchObject({ week: week.number, startDate: week.startDate })
      }
    }
  })

  it('runs Weeks Monday to Sunday', () => {
    expect(on('2026-10-25').position).toMatchObject({ week: 1, daysLeft: 1 })
    expect(on('2026-10-26').position).toMatchObject({ week: 2, daysLeft: 7 })
    expect(on('2026-11-04').position).toMatchObject({ week: 3, daysLeft: 5 })
  })

  it('is before the Program until Week 1 and finished after Week 27', () => {
    expect(on('2026-10-13').position).toEqual({ kind: 'before-start', startsOn: '2026-10-19', daysToStart: 6 })
    expect(on('2026-10-18').position).toMatchObject({ kind: 'before-start', daysToStart: 1 })
    expect(on('2027-04-25').position).toMatchObject({ kind: 'in-week', week: 27, daysLeft: 1 })
    expect(on('2027-04-26').position).toEqual({ kind: 'finished' })
  })
})

describe('Week boundaries in America/Toronto', () => {
  it('turns the Week at midnight in Toronto, not in UTC', () => {
    // Sunday 25 Oct, 23:59:59 EDT is already Monday in UTC.
    expect(weekOf(at('2026-10-26T03:59:59Z'))).toBe(1)
    expect(weekOf(at('2026-10-26T04:00:00Z'))).toBe(2)
  })

  it('keeps the boundary at local midnight after clocks fall back on 1 November', () => {
    // EST now: midnight Monday 2 Nov is 05:00 UTC, an hour later than the Week before.
    expect(weekOf(at('2026-11-02T04:59:59Z'))).toBe(2)
    expect(weekOf(at('2026-11-02T05:00:00Z'))).toBe(3)
  })

  it('keeps the boundary at local midnight after clocks spring forward on 14 March', () => {
    // Monday 15 March 2027 is Week 22; EDT again, so midnight is 04:00 UTC.
    expect(weekOf(at('2027-03-15T03:59:59Z'))).toBe(21)
    expect(weekOf(at('2027-03-15T04:00:00Z'))).toBe(22)
  })

  it('starts the Program at midnight in Toronto', () => {
    expect(weekOf(at('2026-10-19T03:59:59Z'))).toBe('before-start')
    expect(weekOf(at('2026-10-19T04:00:00Z'))).toBe(1)
  })
})

describe('days to Race day', () => {
  it.each([
    ['2026-10-13', 190],
    ['2026-10-19', 184],
    ['2026-11-04', 168],
    ['2027-03-13', 39],
    ['2027-03-15', 37],
    ['2027-04-20', 1],
    ['2027-04-21', 0],
    ['2027-04-22', -1],
  ])('on %s is %i', (iso, days) => {
    expect(on(iso).daysToRace).toBe(days)
  })

  it('counts calendar days in Toronto, whatever the hour', () => {
    expect(at('2027-04-21T03:59:59Z').daysToRace).toBe(1)
    expect(at('2027-04-21T04:00:00Z').daysToRace).toBe(0)
  })
})

describe('Phase completion', () => {
  const completion = (iso: string) =>
    Object.fromEntries(on(iso).phases.map((p) => [p.id, p.completion]))
  const current = (iso: string) => on(iso).phases.filter((p) => p.current).map((p) => p.id)

  it('lists all five Phases in order', () => {
    expect(on('2026-11-04').phases.map((p) => p.name)).toEqual([
      'Foundation',
      '5K development',
      'HYROX build',
      'Race specific',
      'Taper',
    ])
  })

  it('counts the Weeks of the current Phase already behind today', () => {
    expect(completion('2026-11-04')).toEqual({
      foundation: 2 / 6,
      '5k-development': 0,
      'hyrox-build': 0,
      'race-specific': 0,
      taper: 0,
    })
    expect(current('2026-11-04')).toEqual(['foundation'])
  })

  it('fills earlier Phases once the next one starts', () => {
    expect(completion('2026-11-30')).toMatchObject({ foundation: 1, '5k-development': 0 })
    expect(current('2026-11-30')).toEqual(['5k-development'])
    expect(completion('2027-04-21')).toMatchObject({ 'race-specific': 1, taper: 1 / 2 })
  })

  it('is empty before the Program and full after it', () => {
    expect(Object.values(completion('2026-10-13'))).toEqual([0, 0, 0, 0, 0])
    expect(current('2026-10-13')).toEqual([])
    expect(Object.values(completion('2027-05-01'))).toEqual([1, 1, 1, 1, 1])
    expect(current('2027-05-01')).toEqual([])
  })
})

describe('Up next', () => {
  it("is the first planned Session in the current Week's Bucket", () => {
    expect(on('2026-10-19').upNext).toMatchObject({ type: 'speed', headline: '5 × 2′' })
    expect(on('2026-10-25').upNext).toMatchObject({ type: 'speed' })
    expect(on('2026-10-28').upNext).toMatchObject({ type: '5k-test', key: true })
    expect(on('2026-11-04').upNext).toMatchObject({ type: 'speed', headline: '5 × 3′' })
  })

  it('shows the current Week as the Bucket', () => {
    const day = on('2026-11-04')
    expect(day.week?.number).toBe(3)
    expect(day.week?.sessions.map((s) => s.type)).toEqual(['speed', 'strength', 'threshold', 'hyrox', 'easy'])
  })

  it('is never the Optional session', () => {
    const [foundation, ...rest] = program.phases
    const [week1, ...otherWeeks] = foundation.weeks
    const easyFirst: Program = {
      ...program,
      phases: [
        {
          ...foundation,
          weeks: [
            {
              ...week1,
              sessions: [...week1.sessions.filter((s) => s.optional), ...week1.sessions.filter((s) => !s.optional)],
            },
            ...otherWeeks,
          ],
        },
        ...rest,
      ],
    }
    expect(on('2026-10-19', easyFirst).week?.sessions[0].optional).toBe(true)
    expect(on('2026-10-19', easyFirst).upNext?.optional).toBe(false)
  })

  it('waits for Monday before the Program starts, showing Week 1 ahead', () => {
    const day = on('2026-10-13')
    expect(day.upNext).toBeNull()
    expect(day.week?.number).toBe(1)
  })

  it('is the race in Race week, and empty after the Program', () => {
    expect(on('2027-04-21').upNext).toMatchObject({ id: 'race', date: '2027-04-21', key: true })

    expect(on('2027-05-01').week).toBeNull()
    expect(on('2027-05-01').upNext).toBeNull()
  })
})
