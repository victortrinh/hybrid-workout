import { describe, expect, it } from 'vitest'
import { daysBetween, isoWeekday, localDate, localDateIn, type LocalDate } from './calendar'
import { DEFAULT_EQUIPMENT, equipWeek } from './equipment'
import { coach, findWeek, keyDeadline, prescribedWeek, programStart, weekOutcome, type CoachInput } from './coach'
import { parseActivity } from './activity'
import { isLive } from './lifts'
import type { LoggedStatus, SessionLog } from './log'
import type { PainArea, PainReport } from './pain'
import { program } from './program/program'
import type { RecoveryNight } from './recovery'
import type { Program } from './program/types'
import type { Decision, SuggestionDecision } from './suggestion'

/**
 * Every Key session of the Weeks before `today` done on its Week's Monday: a
 * history with nothing carried over, too long ago to touch the spacing rules.
 */
function keysDoneBefore(today: LocalDate, p: Program = program): SessionLog[] {
  return p.phases
    .flatMap((phase) => phase.weeks)
    .filter((week) => daysBetween(week.startDate, today) >= 7)
    .flatMap((week) =>
      week.sessions
        .filter((s) => s.key)
        .map((s) => ({
          id: `key-${week.number}-${s.id}`,
          week: week.number,
          sessionId: s.id,
          date: week.startDate,
          status: 'done' as const,
          minutes: s.minutes,
          rpe: 7,
          notes: null,
          resultSeconds: null,
          environment: null,
          distanceMeters: null,
          recoveryPace: null,
          intervals: [],
          sets: [],
          stations: [],
          updatedAt: '2026-10-08T12:00:00.000Z',
        })),
    )
}

const on = (iso: string, p: Program = program) =>
  coach({ program: p, today: localDate(iso), logs: keysDoneBefore(localDate(iso), p) })
/** What the Coach says at an exact instant, read on a clock in Toronto. */
const at = (instant: string) => coach({ program, today: localDateIn(new Date(instant)) })

const weekOf = (day: ReturnType<typeof coach>) =>
  day.position.kind === 'in-week' ? day.position.week : day.position.kind

describe('the Program calendar', () => {
  it('starts Week 1 on Monday 26 October 2026', () => {
    expect(programStart(program)).toBe('2026-10-26')
    expect(isoWeekday(programStart(program))).toBe(1)

    const day = on('2026-10-26')
    expect(day.position).toEqual({
      kind: 'in-week',
      week: 1,
      phase: 'foundation',
      startDate: '2026-10-26',
      endDate: '2026-11-01',
      daysLeft: 7,
    })
  })

  it('puts Race day, Wednesday 21 April 2027, in Week 26', () => {
    expect(isoWeekday(program.raceDay)).toBe(3)
    const day = on('2027-04-21')
    expect(day.position).toMatchObject({ kind: 'in-week', week: 26, phase: 'taper', startDate: '2027-04-19' })
  })

  it('dates every encoded Week to the Monday the calendar gives it', () => {
    for (const phase of program.phases) {
      for (const week of phase.weeks) {
        expect(on(week.startDate).position).toMatchObject({ week: week.number, startDate: week.startDate })
      }
    }
  })

  it('runs Weeks Monday to Sunday', () => {
    expect(on('2026-11-01').position).toMatchObject({ week: 1, daysLeft: 1 })
    expect(on('2026-11-02').position).toMatchObject({ week: 2, daysLeft: 7 })
    expect(on('2026-11-11').position).toMatchObject({ week: 3, daysLeft: 5 })
  })

  it('is before the Program until Week 1 and finished after Week 26', () => {
    expect(on('2026-10-20').position).toEqual({ kind: 'before-start', startsOn: '2026-10-26', daysToStart: 6 })
    expect(on('2026-10-25').position).toMatchObject({ kind: 'before-start', daysToStart: 1 })
    expect(on('2027-04-25').position).toMatchObject({ kind: 'in-week', week: 26, daysLeft: 1 })
    expect(on('2027-04-26').position).toEqual({ kind: 'finished' })
  })
})

describe('Week boundaries in America/Toronto', () => {
  it('turns the Week at midnight in Toronto, not in UTC', () => {
    // Sunday 8 Nov, 23:59:59 EST is already Monday in UTC.
    expect(weekOf(at('2026-11-09T04:59:59Z'))).toBe(2)
    expect(weekOf(at('2026-11-09T05:00:00Z'))).toBe(3)
  })

  it('keeps the boundary at local midnight after clocks fall back on 1 November', () => {
    // EST now: midnight Monday 2 Nov is 05:00 UTC, an hour later than the Week before.
    expect(weekOf(at('2026-11-02T04:59:59Z'))).toBe(1)
    expect(weekOf(at('2026-11-02T05:00:00Z'))).toBe(2)
  })

  it('keeps the boundary at local midnight after clocks spring forward on 14 March', () => {
    // Monday 15 March 2027 is Week 21; EDT again, so midnight is 04:00 UTC.
    expect(weekOf(at('2027-03-15T03:59:59Z'))).toBe(20)
    expect(weekOf(at('2027-03-15T04:00:00Z'))).toBe(21)
  })

  it('starts the Program at midnight in Toronto', () => {
    expect(weekOf(at('2026-10-26T03:59:59Z'))).toBe('before-start')
    expect(weekOf(at('2026-10-26T04:00:00Z'))).toBe(1)
  })
})

describe('days to Race day', () => {
  it.each([
    ['2026-10-20', 183],
    ['2026-10-26', 177],
    ['2026-11-11', 161],
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
    expect(on('2026-11-11').phases.map((p) => p.name)).toEqual([
      'Foundation',
      '5K development',
      'HYROX build',
      'Race specific',
      'Taper',
    ])
  })

  it('counts the Weeks of the current Phase already behind today', () => {
    expect(completion('2026-11-11')).toEqual({
      foundation: 2 / 5,
      '5k-development': 0,
      'hyrox-build': 0,
      'race-specific': 0,
      taper: 0,
    })
    expect(current('2026-11-11')).toEqual(['foundation'])
  })

  it('fills earlier Phases once the next one starts', () => {
    expect(completion('2026-11-30')).toMatchObject({ foundation: 1, '5k-development': 0 })
    expect(current('2026-11-30')).toEqual(['5k-development'])
    expect(completion('2027-04-21')).toMatchObject({ 'race-specific': 1, taper: 1 / 2 })
  })

  it('is empty before the Program and full after it', () => {
    expect(Object.values(completion('2026-10-20'))).toEqual([0, 0, 0, 0, 0])
    expect(current('2026-10-20')).toEqual([])
    expect(Object.values(completion('2027-05-01'))).toEqual([1, 1, 1, 1, 1])
    expect(current('2027-05-01')).toEqual([])
  })
})

describe('Up next', () => {
  it("is the first planned Session in the current Week's Bucket", () => {
    expect(on('2026-10-26').upNext).toMatchObject({ type: 'speed', headline: '5 × 2′' })
    expect(on('2026-11-01').upNext).toMatchObject({ type: 'speed' })
    expect(on('2026-11-04').upNext).toMatchObject({ type: '5k-test', key: true })
    expect(on('2026-11-11').upNext).toMatchObject({ type: 'speed', headline: '5 × 3′' })
  })

  it('shows the current Week as the Bucket', () => {
    const day = on('2026-11-11')
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
    expect(on('2026-10-26', easyFirst).week?.sessions[0].optional).toBe(true)
    expect(on('2026-10-26', easyFirst).upNext?.optional).toBe(false)
  })

  it('waits for Monday before the Program starts, showing Week 1 ahead', () => {
    const day = on('2026-10-20')
    expect(day.upNext).toBeNull()
    expect(day.week?.number).toBe(1)
  })

  it('is the race in Race week, and empty after the Program', () => {
    expect(on('2027-04-21').upNext).toMatchObject({ id: 'race', date: '2027-04-21', key: true })

    expect(on('2027-05-01').week).toBeNull()
    expect(on('2027-05-01').upNext).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// With Session logs. Week 3 runs Mon 9 – Sun 15 Nov: Speed, Strength,
// Threshold (Key), HYROX, Easy run (Optional). Week 7 is a Deload week whose
// Threshold is an Easy run that isn't Optional.

let nextId = 0
function log(week: number, sessionId: string, date: string, status: LoggedStatus = 'done', updatedAt = '2026-11-08T12:00:00.000Z'): SessionLog {
  return {
    id: `log-${String(++nextId).padStart(4, '0')}`,
    week,
    sessionId,
    date: localDate(date),
    status,
    minutes: 45,
    rpe: 7,
    notes: null,
    resultSeconds: null,
    environment: null,
    distanceMeters: null,
    recoveryPace: null,
    intervals: [],
    sets: [],
    stations: [],
    updatedAt,
  }
}

const withLogs = (iso: string, logs: SessionLog[], picked: CoachInput['picked'] = null) =>
  coach({ program, today: localDate(iso), logs: [...keysDoneBefore(localDate(iso)), ...logs], picked })
const states = (day: ReturnType<typeof coach>) => Object.fromEntries(day.bucket.map((e) => [e.session.id, e.state]))

describe('the Bucket', () => {
  it('is Next for Up next and Planned for the rest while nothing is logged', () => {
    expect(states(on('2026-11-11'))).toEqual({
      speed: 'next',
      strength: 'planned',
      threshold: 'planned',
      hyrox: 'planned',
      easy: 'planned',
    })
  })

  it('shows each logged Session as Done, Partial, Skipped or Swapped, with its log', () => {
    const logs = [
      log(3, 'speed', '2026-11-09', 'done'),
      log(3, 'strength', '2026-11-09', 'partial'),
      // Skipped today, so not offered again until tomorrow.
      log(3, 'threshold', '2026-11-11', 'skipped'),
      log(3, 'hyrox', '2026-11-10', 'swapped'),
    ]
    const day = withLogs('2026-11-11', logs)
    expect(states(day)).toEqual({ speed: 'done', strength: 'partial', threshold: 'skipped', hyrox: 'swapped', easy: 'next' })
    expect(day.bucket[0].log).toBe(logs[0])
    expect(day.bucket[4].log).toBeNull()
  })

  it('goes by the latest edit when a Session has more than one log', () => {
    const logs = [
      log(3, 'speed', '2026-11-09', 'done', '2026-11-09T20:00:00.000Z'),
      log(3, 'speed', '2026-11-09', 'partial', '2026-11-10T08:00:00.000Z'),
    ]
    expect(states(withLogs('2026-11-11', logs)).speed).toBe('partial')
  })

  it('ignores logs from other Weeks', () => {
    expect(states(withLogs('2026-11-11', [log(2, 'strength', '2026-11-03')])).strength).toBe('planned')
  })

  it('shows Week 1 all Planned before the Program starts', () => {
    expect(new Set(Object.values(states(on('2026-10-20'))))).toEqual(new Set(['planned']))
  })

  it('is empty after the Program', () => {
    expect(on('2027-05-01').bucket).toEqual([])
  })
})

describe('Up next with Session logs', () => {
  it('moves past logged Sessions to the oldest-waiting one, in Bucket order', () => {
    const day = withLogs('2026-11-11', [log(3, 'speed', '2026-11-09')])
    expect(day.upNext?.id).toBe('strength')
    expect(day.rest).toBeNull()
  })

  it('moves past Skipped and Swapped Sessions too', () => {
    const logs = [log(3, 'speed', '2026-11-09', 'skipped'), log(3, 'strength', '2026-11-09', 'swapped')]
    expect(withLogs('2026-11-11', logs).upNext?.id).toBe('threshold')
  })

  describe('a Skipped Session while the Week has days left', () => {
    const rest = [log(3, 'speed', '2026-11-09'), log(3, 'strength', '2026-11-10'), log(3, 'threshold', '2026-11-12')]

    it('comes back as Up next once nothing untouched is left', () => {
      const day = withLogs('2026-11-14', [...rest, log(3, 'hyrox', '2026-11-11', 'skipped')])
      expect(day.upNext?.id).toBe('hyrox')
      expect(day.rest).toBeNull()
      expect(states(day).hyrox).toBe('next')
    })

    it('still counts as to do in the Bucket', () => {
      const day = withLogs('2026-11-14', [...rest, log(3, 'hyrox', '2026-11-11', 'skipped')])
      expect(day.bucket.filter((e) => e.toDo).map((e) => e.session.id)).toEqual(['hyrox', 'easy'])
    })

    it('waits behind Sessions not logged at all', () => {
      const day = withLogs('2026-11-14', [rest[0], rest[1], log(3, 'threshold', '2026-11-11', 'skipped')])
      expect(day.upNext?.id).toBe('hyrox')
      const later = withLogs('2026-11-13', [rest[0], log(3, 'strength', '2026-11-10', 'skipped')])
      expect(later.upNext?.id).toBe('threshold')
    })

    it('is not offered again the day it was Skipped', () => {
      const logs = [...rest, log(3, 'easy', '2026-11-13'), log(3, 'hyrox', '2026-11-14', 'skipped')]
      const day = withLogs('2026-11-14', logs)
      expect(day.upNext).toBeNull()
      expect(day.rest).toMatchObject({ kind: 'skipped-today', lastDay: false })
      expect(withLogs('2026-11-15', logs).upNext?.id).toBe('hyrox')
    })

    it('closes the Week with a miss when Skipped on Sunday', () => {
      const logs = [...rest, log(3, 'easy', '2026-11-13'), log(3, 'hyrox', '2026-11-15', 'skipped')]
      const day = withLogs('2026-11-15', logs)
      expect(day.rest).toMatchObject({ kind: 'skipped-today', lastDay: true })
      expect(day.rest?.kind === 'skipped-today' && day.rest.sessions.map((s) => s.id)).toEqual(['hyrox'])
    })

    it('can be picked to do today', () => {
      const day = withLogs('2026-11-14', [...rest, log(3, 'hyrox', '2026-11-14', 'skipped')], {
        date: localDate('2026-11-14'),
        week: 3,
        sessionId: 'hyrox',
      })
      expect(day.upNext?.id).toBe('hyrox')
    })

    it('gives way to the Week done once it is made up', () => {
      const logs = [
        ...rest,
        log(3, 'easy', '2026-11-13'),
        log(3, 'hyrox', '2026-11-11', 'skipped', '2026-11-11T12:00:00.000Z'),
        log(3, 'hyrox', '2026-11-14', 'done', '2026-11-14T12:00:00.000Z'),
      ]
      expect(withLogs('2026-11-14', logs).rest).toEqual({ kind: 'week-done' })
    })
  })

  it('is never Week done while a required Session is Skipped', () => {
    const logs = ['speed', 'strength', 'threshold', 'easy'].map((id) => log(3, id, '2026-11-09'))
    const day = withLogs('2026-11-12', [...logs, log(3, 'hyrox', '2026-11-10', 'skipped')])
    expect(day.rest).not.toEqual({ kind: 'week-done' })
    expect(day.upNext?.id).toBe('hyrox')
  })

  it('is Week done with the Optional session Skipped: missing it is not a miss', () => {
    const logs = ['speed', 'strength', 'threshold', 'hyrox'].map((id) => log(3, id, '2026-11-09'))
    const day = withLogs('2026-11-12', [...logs, log(3, 'easy', '2026-11-10', 'skipped')])
    expect(day.rest).toEqual({ kind: 'week-done' })
  })

  describe('no two Hard sessions on consecutive days when avoidable', () => {
    it('rests the day after a Hard session when the Week can still fit the rest', () => {
      // Thursday: Threshold and HYROX left, four days to fit them in.
      const day = withLogs('2026-11-12', [log(3, 'speed', '2026-11-09'), log(3, 'strength', '2026-11-11')])
      expect(day.upNext).toBeNull()
      expect(day.rest).toEqual({ kind: 'hard-yesterday' })
    })

    it('goes Hard anyway when resting would leave too few days', () => {
      // Wednesday: Strength, Threshold and HYROX left in five days. Resting today
      // leaves four, which hold only two Hard sessions apart.
      const day = withLogs('2026-11-11', [log(3, 'speed', '2026-11-10')])
      expect(day.upNext?.id).toBe('strength')
    })

    it('stops at one Hard session a day when the Week has room', () => {
      const day = withLogs('2026-11-09', [log(3, 'speed', '2026-11-09')])
      expect(day.upNext).toBeNull()
      expect(day.rest).toEqual({ kind: 'hard-today' })
    })

    it('allows a second Hard session today when the Week runs out otherwise', () => {
      const logs = [log(3, 'speed', '2026-11-09'), log(3, 'strength', '2026-11-11'), log(3, 'threshold', '2026-11-15')]
      expect(withLogs('2026-11-15', logs).upNext?.id).toBe('hyrox')
    })

    it('picks the Easy run that is not Optional over a Hard session after a Hard day', () => {
      // Week 7, a Deload week: Speed done Monday, so Tuesday is the Easy run before Strength.
      const day = withLogs('2026-12-08', [log(7, 'speed', '2026-12-07')])
      expect(day.upNext).toMatchObject({ id: 'easy-deload', type: 'easy', optional: false })
    })

    it('counts the Hard day before Monday across the Week boundary', () => {
      // HYROX done Sunday of Week 2; Week 3 starts with four Hard sessions in seven days.
      const day = withLogs('2026-11-09', [log(2, 'hyrox', '2026-11-08')])
      expect(day.upNext?.id).not.toBe('speed')
    })

    it('does not count Skipped or Swapped Sessions as a Hard day', () => {
      const day = withLogs('2026-11-12', [log(3, 'speed', '2026-11-09'), log(3, 'strength', '2026-11-11', 'skipped')])
      expect(day.upNext?.id).toBe('threshold')
    })

    it('counts a Partial Session as a Hard day', () => {
      const day = withLogs('2026-11-12', [log(3, 'speed', '2026-11-09'), log(3, 'strength', '2026-11-11', 'partial')])
      expect(day.rest).toEqual({ kind: 'hard-yesterday' })
    })
  })

  describe('never Speed the day after HYROX or Strength', () => {
    it('skips Speed for the next Session after Strength yesterday', () => {
      // Thursday, too little room to rest: Speed, Threshold and HYROX left in four days.
      const day = withLogs('2026-11-12', [log(3, 'strength', '2026-11-11')])
      expect(day.upNext?.id).toBe('threshold')
    })

    it('skips Speed after HYROX on the Sunday before', () => {
      const day = withLogs('2026-11-09', [log(2, 'hyrox', '2026-11-08')])
      expect(day.upNext?.id).toBe('strength')
    })

    it('treats a 5K test as Speed', () => {
      // Week 2 opens with the baseline 5K test; HYROX was done the Sunday before.
      const day = withLogs('2026-11-02', [log(1, 'hyrox', '2026-11-01')])
      expect(day.upNext?.id).toBe('strength')
    })

    it('rests rather than putting Speed after Strength, even when Speed is all that is left', () => {
      const logs = [
        log(3, 'threshold', '2026-11-09'),
        log(3, 'hyrox', '2026-11-11'),
        log(3, 'strength', '2026-11-14'),
      ]
      const day = withLogs('2026-11-15', logs)
      expect(day.upNext).toBeNull()
      expect(day.rest).toEqual({ kind: 'speed-after-load' })
    })

    it('keeps Speed off the same day as Strength too', () => {
      const logs = [log(3, 'threshold', '2026-11-09'), log(3, 'hyrox', '2026-11-11'), log(3, 'strength', '2026-11-15')]
      expect(withLogs('2026-11-15', logs).rest).toEqual({ kind: 'speed-after-load' })
    })

    it('allows Speed the day after Threshold', () => {
      const day = withLogs('2026-11-13', [log(3, 'strength', '2026-11-09'), log(3, 'threshold', '2026-11-12')])
      expect(day.upNext?.id).toBe('speed')
    })
  })

  describe('Strength and an Easy run on the same day', () => {
    it('offers the Easy run after Strength the same day', () => {
      const day = withLogs('2026-12-09', [log(7, 'speed', '2026-12-07'), log(7, 'strength', '2026-12-09')])
      expect(day.upNext?.id).toBe('easy-deload')
    })

    it('offers the Optional Easy run after Strength once nothing else is left', () => {
      const logs = [
        log(3, 'speed', '2026-11-09'),
        log(3, 'threshold', '2026-11-11'),
        log(3, 'hyrox', '2026-11-13'),
        log(3, 'strength', '2026-11-15'),
      ]
      expect(withLogs('2026-11-15', logs).upNext?.id).toBe('easy')
    })
  })

  describe('the Optional session', () => {
    it('is never Up next on a rest day while other Sessions remain', () => {
      const day = withLogs('2026-11-12', [log(3, 'speed', '2026-11-09'), log(3, 'strength', '2026-11-11')])
      expect(day.upNext).toBeNull()
    })

    it('is Up next once every other Session is logged', () => {
      const logs = ['speed', 'strength', 'threshold', 'hyrox'].map((id, i) => log(3, id, `2026-11-0${2 + i * 2}`))
      expect(withLogs('2026-11-15', logs).upNext?.id).toBe('easy')
    })

    it('leaves the Week done once it is logged as well', () => {
      const logs = ['speed', 'strength', 'threshold', 'hyrox', 'easy'].map((id) => log(3, id, '2026-11-09'))
      const day = withLogs('2026-11-15', logs)
      expect(day.upNext).toBeNull()
      expect(day.rest).toEqual({ kind: 'week-done' })
    })
  })

  describe('a Session picked from the Bucket', () => {
    const picked = (sessionId: string, date = '2026-11-11', week = 3) => ({ date: localDate(date), week, sessionId })

    it('becomes Up next, and the previous Up next goes back to Planned', () => {
      const day = withLogs('2026-11-11', [], picked('hyrox'))
      expect(day.upNext?.id).toBe('hyrox')
      expect(states(day)).toMatchObject({ speed: 'planned', hyrox: 'next' })
    })

    it('overrides the spacing rules: the athlete decides', () => {
      const day = withLogs('2026-11-12', [log(3, 'strength', '2026-11-11')], picked('speed', '2026-11-12'))
      expect(day.upNext?.id).toBe('speed')
    })

    it('can be the Optional session', () => {
      expect(withLogs('2026-11-11', [], picked('easy')).upNext?.id).toBe('easy')
    })

    it('lasts only for the day it was picked', () => {
      expect(withLogs('2026-11-12', [], picked('hyrox', '2026-11-11')).upNext?.id).toBe('speed')
    })

    it('gives way once it is logged', () => {
      const day = withLogs('2026-11-11', [log(3, 'threshold', '2026-11-11')], picked('threshold'))
      expect(day.upNext?.id).toBe('speed')
    })

    it('before the Program, makes a Week 1 Session Up next, early', () => {
      const day = withLogs('2026-10-20', [], picked('threshold', '2026-10-20', 1))
      expect(day.upNext?.id).toBe('threshold')
      expect(states(day)).toMatchObject({ speed: 'planned', threshold: 'next' })
      expect(withLogs('2026-10-21', [], picked('threshold', '2026-10-20', 1)).upNext).toBeNull()
      expect(withLogs('2026-10-20', [log(1, 'threshold', '2026-10-20')], picked('threshold', '2026-10-20', 1)).upNext).toBeNull()
    })
  })

  describe('Race week', () => {
    it('offers the shakeout before Race day', () => {
      expect(on('2027-04-19').upNext?.id).toBe('shakeout')
    })

    it('waits for Race day once the shakeout is logged', () => {
      const day = withLogs('2027-04-20', [log(26, 'shakeout', '2027-04-19')])
      expect(day.upNext).toBeNull()
      expect(day.rest).toMatchObject({ kind: 'waiting', session: { id: 'race' }, date: '2027-04-21' })
    })

    it('pins the race to Race day: it can’t be picked for another day', () => {
      const pickRace = { date: localDate('2027-04-20'), week: 26, sessionId: 'race' }
      const day = withLogs('2027-04-20', [], pickRace)
      expect(day.upNext?.id).toBe('shakeout')
      expect(day.bucket.map((e) => [e.session.id, e.pickable])).toEqual([
        ['shakeout', true],
        ['race', false],
      ])
      expect(on('2027-04-21').bucket.find((e) => e.session.id === 'race')?.pickable).toBe(true)
    })

    it('is the race on Race day, whatever was done the day before', () => {
      const day = withLogs('2027-04-21', [log(26, 'shakeout', '2027-04-20')])
      expect(day.upNext?.id).toBe('race')
    })
  })
})

// ---------------------------------------------------------------------------
// Week rollover. Week 3's Key session is Threshold; Week 4 runs Mon 16 – Sun 22 Nov.
// Week 7 is a Deload week with no Key session.

const week = (n: number) => findWeek(program, n)!
const outcome = (n: number, iso: string, logs: SessionLog[] = []) =>
  weekOutcome(program, week(n), logs, localDate(iso))
const missed = (o: ReturnType<typeof outcome>) => o.skipped.map(({ session, by }) => `${session.id} by ${by}`)
/** Everything before Week 3 settled; Week 3's own logs as given. */
const inWeek4 = (iso: string, logs: SessionLog[] = []) =>
  coach({ program, today: localDate(iso), logs: [...keysDoneBefore(localDate('2026-11-09')), ...logs] })

describe('the Key session carries over', () => {
  it('into the next Week until Wednesday, first in the Bucket and Up next', () => {
    for (const iso of ['2026-11-16', '2026-11-17', '2026-11-18']) {
      const day = inWeek4(iso)
      expect(day.bucket[0]).toMatchObject({ week: 3, session: { id: 'threshold', key: true }, carriedUntil: '2026-11-18' })
      expect(day.bucket.slice(1).map((e) => [e.week, e.carriedUntil])).toEqual(Array(5).fill([4, null]))
      expect(day.upNext).toMatchObject({ id: 'threshold', headline: '2 × 12′' })
      expect(day.bucket[0].state).toBe('next')
    }
  })

  it('is gone on Thursday, Skipped by the Coach', () => {
    const day = inWeek4('2026-11-19')
    expect(day.bucket.map((e) => e.week)).toEqual([4, 4, 4, 4, 4])
    expect(missed(outcome(3, '2026-11-19'))).toContain('threshold by coach')
    expect(outcome(3, '2026-11-19').carried).toBeNull()
  })

  it('shows as Done once logged in the carry-over, and is no miss', () => {
    const done = log(3, 'threshold', '2026-11-17')
    const day = inWeek4('2026-11-18', [done])
    expect(day.bucket[0]).toMatchObject({ week: 3, state: 'done', log: done })
    expect(day.upNext?.id).not.toBe('threshold')
    expect(missed(outcome(3, '2026-11-19', [done]))).not.toContain('threshold by coach')
  })

  it('counts toward the spacing rules on the day it is done', () => {
    // Week 4's Speed and Strength done, then the carried Threshold on Wednesday: Thursday
    // rests, with Week 4's Threshold and HYROX still fitting into Friday to Sunday.
    const logs = [log(4, 'speed', '2026-11-16'), log(4, 'strength', '2026-11-17'), log(3, 'threshold', '2026-11-18')]
    const day = inWeek4('2026-11-19', logs)
    expect(day.upNext).toBeNull()
    expect(day.rest).toEqual({ kind: 'hard-yesterday' })
  })

  it('can be picked from the Bucket like any other Session', () => {
    const day = coach({
      program,
      today: localDate('2026-11-16'),
      logs: keysDoneBefore(localDate('2026-11-09')),
      picked: { date: localDate('2026-11-16'), week: 4, sessionId: 'hyrox' },
    })
    expect(day.upNext?.id).toBe('hyrox')
    expect(day.bucket[0]).toMatchObject({ week: 3, state: 'planned' })
  })

  it('is the only Session that carries: nothing else does, the Optional session least of all', () => {
    const day = inWeek4('2026-11-16')
    expect(day.bucket.filter((e) => e.carriedUntil)).toHaveLength(1)
    expect(outcome(3, '2026-11-16').carried?.session.id).toBe('threshold')
  })

  it('stops at Wednesday whichever Week it is', () => {
    expect(keyDeadline(program, week(1))).toBe('2026-11-04')
    expect(keyDeadline(program, week(13))).toBe('2027-01-27')
  })

  it('never spills from the Taper into Race week', () => {
    expect(keyDeadline(program, week(25))).toBe('2027-04-18')
    const day = coach({ program, today: localDate('2027-04-19'), logs: keysDoneBefore(localDate('2027-04-12')) })
    expect(day.bucket.map((e) => e.week)).toEqual([26, 26])
    expect(missed(outcome(25, '2027-04-19'))).toContain('speed by coach')
  })
})

describe('Sessions not done by Sunday', () => {
  it('stay open through Sunday, in America/Toronto', () => {
    expect(outcome(3, '2026-11-15')).toEqual({ skipped: [], carried: null })
    // 23:59 Sunday in Toronto is already Monday in UTC; the Week is still open.
    expect(outcome(3, localDateIn(new Date('2026-11-16T04:59:59Z')))).toEqual({ skipped: [], carried: null })
  })

  it('become Skipped at the end of Sunday, apart from the Key session', () => {
    const o = outcome(3, localDateIn(new Date('2026-11-16T05:00:00Z')))
    expect(missed(o)).toEqual(['speed by coach', 'strength by coach', 'hyrox by coach'])
    expect(o.carried).toEqual({ session: expect.objectContaining({ id: 'threshold' }), until: '2026-11-18' })
  })

  it('leave the Optional session alone: missing it is not a miss', () => {
    expect(missed(outcome(3, '2026-11-20'))).not.toContain('easy by coach')
    expect(missed(outcome(3, '2026-11-20', [log(3, 'easy', '2026-11-10', 'skipped')]))).not.toContain('easy by athlete')
  })

  it('count a Skipped log once the Week is over, and never Done, Partial or Swapped', () => {
    const logs = [
      log(3, 'speed', '2026-11-09', 'skipped'),
      log(3, 'strength', '2026-11-10', 'partial'),
      log(3, 'threshold', '2026-11-11', 'swapped'),
      log(3, 'hyrox', '2026-11-12', 'done'),
    ]
    // Until Sunday a Skipped Session can still be done: not a miss yet.
    expect(missed(outcome(3, '2026-11-11', logs))).toEqual([])
    expect(missed(outcome(3, '2026-11-15', logs))).toEqual([])
    expect(missed(outcome(3, '2026-11-20', logs))).toEqual(['speed by athlete'])
  })

  it('count a Key session Skipped in its carry-over only once the carry-over ends', () => {
    const logs = [log(3, 'threshold', '2026-11-16', 'skipped')]
    expect(missed(outcome(3, '2026-11-17', logs))).not.toContain('threshold by athlete')
    expect(outcome(3, '2026-11-17', logs).carried?.session.id).toBe('threshold')
    expect(missed(outcome(3, '2026-11-19', logs))).toContain('threshold by athlete')
  })

  it('leave a Deload week, with no Key session, nothing to carry', () => {
    const o = outcome(7, '2026-12-14')
    expect(o.carried).toBeNull()
    expect(missed(o)).toEqual(['speed by coach', 'strength by coach', 'easy-deload by coach', 'hyrox by coach'])
  })
})

// ---------------------------------------------------------------------------
// The lighter re-entry Week. Week 9 (Mon 21 – Sun 27 Dec): Speed is Key.
// Week 10 (Mon 28 Dec – Sun 3 Jan): Speed 4 × 4′, Key.

const week9 = (statuses: Partial<Record<string, LoggedStatus>>) =>
  Object.entries(statuses).map(([id, status], i) => log(9, id, `2026-12-2${1 + i}`, status))
const TWO_SKIPPED = { speed: 'done', strength: 'done', threshold: 'skipped', hyrox: 'skipped' } as const

function decided(decision: Decision, date = '2026-12-29', updatedAt = '2026-12-29T12:00:00.000Z'): SuggestionDecision {
  return { id: 're-entry-w10', decision, date: localDate(date), updatedAt }
}

const inWeek10 = (logs: SessionLog[], decisions: SuggestionDecision[] = [], iso = '2026-12-29') =>
  coach({ program, today: localDate(iso), logs: [...keysDoneBefore(localDate('2026-12-21')), ...logs], decisions })

describe('the re-entry Suggestion', () => {
  it('comes with two Skipped Sessions last Week, as structured facts', () => {
    expect(inWeek10(week9(TWO_SKIPPED)).suggestions).toEqual([
      {
        id: 're-entry-w10',
        kind: 're-entry',
        week: 10,
        sessionId: null,
        date: '2026-12-28',
        from: { volumePercent: 100 },
        to: { volumePercent: 67 },
        trigger: {
          week: 9,
          skipped: [
            { sessionId: 'threshold', type: 'threshold' },
            { sessionId: 'hyrox', type: 'hyrox' },
          ],
        },
        decision: 'open',
        decidedOn: null,
      },
    ])
  })

  it('stays away with one Skipped Session', () => {
    expect(inWeek10(week9({ ...TWO_SKIPPED, threshold: 'done' })).suggestions).toEqual([])
  })

  it('counts Sessions the Coach Skipped at the end of Sunday', () => {
    const day = inWeek10(week9({ speed: 'done', strength: 'done' }))
    const [reEntry] = day.suggestions
    expect(reEntry.kind === 're-entry' && reEntry.trigger.skipped.map((s) => s.sessionId)).toEqual(['threshold', 'hyrox'])
  })

  it('does not count the Key session while it is carried over', () => {
    // Speed (Key) and Strength undone: Speed carries, so only Strength is Skipped.
    expect(inWeek10(week9({ threshold: 'done', hyrox: 'done' })).suggestions).toEqual([])
    // Even after its carry-over runs out: the count is taken as the Week closed.
    expect(inWeek10(week9({ threshold: 'done', hyrox: 'done' }), [], '2026-12-31').suggestions).toEqual([])
  })

  it('stays when Skipped Sessions are made up late, from Monday on', () => {
    const madeUp = [log(9, 'threshold', '2026-12-28'), log(9, 'hyrox', '2026-12-29')]
    const day = inWeek10([...week9({ speed: 'done', strength: 'done' }), ...madeUp], [], '2026-12-29')
    expect(day.suggestions.map((s) => s.id)).toEqual(['re-entry-w10'])
    // A Skipped log edited to Done after the Week closed still counts as Skipped.
    const edited = week9(TWO_SKIPPED).map((l) =>
      l.status === 'skipped' ? { ...l, status: 'done' as const, date: localDate('2026-12-29') } : l,
    )
    expect(inWeek10(edited).suggestions.map((s) => s.id)).toEqual(['re-entry-w10'])
    // Done by Sunday, it was never a miss.
    expect(inWeek10(week9({ ...TWO_SKIPPED, threshold: 'done', hyrox: 'done' })).suggestions).toEqual([])
  })

  it('is about this Week only: gone the Week after', () => {
    const logs = [...week9(TWO_SKIPPED), ...['speed', 'strength', 'easy-deload', 'hyrox'].map((id) => log(11, id, '2027-01-04'))]
    expect(inWeek10(logs, [], '2027-01-04').suggestions.map((s) => s.id)).not.toContain('re-entry-w10')
  })

  it('never lightens a Deload week, nor the Taper or Race week', () => {
    // Week 6 with two Skipped, then Week 7, a Deload.
    const deload = coach({
      program,
      today: localDate('2026-12-08'),
      logs: [...keysDoneBefore(localDate('2026-11-30')), log(6, 'speed', '2026-11-30', 'skipped'), log(6, 'hyrox', '2026-11-30', 'skipped')],
    })
    expect(deload.suggestions).toEqual([])
    // Nothing logged in Week 24 or 26.
    expect(coach({ program, today: localDate('2027-04-13'), logs: keysDoneBefore(localDate('2027-04-13')) }).suggestions).toEqual([])
    expect(coach({ program, today: localDate('2027-04-20'), logs: keysDoneBefore(localDate('2027-04-20')) }).suggestions).toEqual([])
  })

  it('changes nothing until it is Accepted', () => {
    const day = inWeek10(week9(TWO_SKIPPED))
    expect(day.upNext).toMatchObject({ id: 'speed', headline: '4 × 4′', minutes: 45 })
    expect(day.week).toEqual(equipWeek(findWeek(program, 10)!, DEFAULT_EQUIPMENT))
  })

  it('lightens every Prescription of the Week by a third once Accepted', () => {
    const day = inWeek10(week9(TWO_SKIPPED), [decided('accepted')])
    expect(day.suggestions[0]).toMatchObject({ decision: 'accepted', decidedOn: '2026-12-29' })
    expect(day.upNext).toMatchObject({ id: 'speed', headline: '3 × 4′', minutes: 30 })
    expect(day.bucket.map((e) => e.session.minutes)).toEqual([30, 30, 30, 34, 27])
    const intervals = day.upNext!.blocks.find((b) => b.main)!.exercises[0].prescription
    expect(intervals).toMatchObject({ kind: 'intervals', reps: 3, workSeconds: 240 })
  })

  it('keeps the Program as written when Kept, and again after Undo', () => {
    for (const d of [decided('kept'), decided('open')]) {
      const day = inWeek10(week9(TWO_SKIPPED), [d])
      expect(day.suggestions[0].decision).toBe(d.decision)
      expect(day.upNext).toMatchObject({ headline: '4 × 4′', minutes: 45 })
    }
  })

  it('shows the lighter Week on other screens too', () => {
    const logs = [...keysDoneBefore(localDate('2026-12-21')), ...week9(TWO_SKIPPED)]
    expect(prescribedWeek(program, 10, logs, [decided('accepted')])?.sessions[0].headline).toBe('3 × 4′')
    expect(prescribedWeek(program, 10, logs, [decided('kept')])?.sessions[0].headline).toBe('4 × 4′')
    expect(prescribedWeek(program, 9, logs, [decided('accepted')])).toEqual(equipWeek(findWeek(program, 9)!, DEFAULT_EQUIPMENT))
  })
})

// ---------------------------------------------------------------------------
// The pain rules. Week 3 (Mon 9 – Sun 15 Nov): Speed 5 × 3′ with jumps and
// four accelerations, Strength, Threshold 2 × 12′ (Key), HYROX, Easy run.

let nextReport = 0
function pain(
  date: string,
  score: number,
  { area = score === 0 ? null : 'achilles-calf', session = null, at = '12:00' }: { area?: PainArea | null; session?: [number, string] | null; at?: string } = {},
): PainReport {
  return {
    id: `report-${String(++nextReport).padStart(4, '0')}`,
    date: localDate(date),
    score,
    area,
    week: session?.[0] ?? null,
    sessionId: session?.[1] ?? null,
    updatedAt: `${date}T${at}:00.000Z`,
  }
}

const painDecision = (report: PainReport, decision: Decision, date = report.date): SuggestionDecision => ({
  id: `pain-${report.id}`,
  decision,
  date: localDate(date),
  updatedAt: `${date}T13:00:00.000Z`,
})

function withPain(iso: string, painReports: PainReport[], decisions: SuggestionDecision[] = [], logs: SessionLog[] = []) {
  return coach({ program, today: localDate(iso), logs: [...keysDoneBefore(localDate(iso)), ...logs], painReports, decisions })
}

/** Only the pain Suggestions: Week 2's Sessions other than the Key one went undone, so re-entry is there too. */
const painOf = (day: ReturnType<typeof coach>) => day.suggestions.filter((s) => s.kind === 'pain')

const exerciseNames = (day: ReturnType<typeof coach>) => day.upNext!.blocks.flatMap((b) => b.exercises.map((e) => e.name))
const mainIntervals = (session: { blocks: { main?: boolean; exercises: { prescription: unknown }[] }[] }) =>
  session.blocks.find((b) => b.main)!.exercises[0].prescription

describe('the pain rules', () => {
  it('stay out of it with no Pain report, or with pain under 3 and not rising', () => {
    expect(painOf(withPain('2026-11-11', []))).toEqual([])
    expect(withPain('2026-11-11', []).pain).toBeNull()
    for (const score of [0, 1, 2]) {
      const day = withPain('2026-11-11', [pain('2026-11-11', score)])
      expect(painOf(day)).toEqual([])
      expect(day.pain).toMatchObject({ report: { score }, level: null })
    }
  })

  it('suggest bike for the jumps and fewer reps at pain 3', () => {
    const report = pain('2026-11-11', 3, { area: 'shin' })
    const day = withPain('2026-11-11', [report])
    expect(painOf(day)).toEqual([
      {
        id: `pain-${report.id}`,
        kind: 'pain',
        week: 3,
        sessionId: null,
        date: '2026-11-11',
        level: 'ease',
        trigger: { score: 3, area: 'shin', risingFrom: null },
        decision: 'open',
        decidedOn: null,
      },
    ])
    expect(day.pain).toMatchObject({ level: 'ease' })
  })

  it('change nothing until the Suggestion is Accepted, nor once it is Kept', () => {
    const report = pain('2026-11-11', 4)
    for (const decisions of [[], [painDecision(report, 'kept')], [painDecision(report, 'open')]]) {
      const day = withPain('2026-11-11', [report], decisions)
      expect(day.upNext).toBe(findWeek(program, 3)!.sessions[0])
    }
  })

  it('swap jumps and accelerations for bike sprints and cut interval reps by about 30% once Accepted', () => {
    const report = pain('2026-11-11', 4)
    const day = withPain('2026-11-11', [report], [painDecision(report, 'accepted')])
    expect(day.upNext).toMatchObject({ id: 'speed', headline: '4 × 3′', minutes: 41 })
    expect(exerciseNames(day)).toEqual([
      'Easy jog',
      'Leg swings',
      'A-skips',
      'B-skips',
      'High knees',
      'Butt kicks',
      'Bike sprints',
      'Bike sprints',
      'Bike sprints',
      'Intervals',
      'Jog or walk',
    ])
    expect(exerciseNames(day)).not.toContain('Accelerations')
    expect(day.upNext!.blocks.map((b) => b.name)).toEqual(['Warm-up', 'Drills', 'Bike sprints', 'Bike sprints', 'Intervals', 'Cooldown'])
    expect(mainIntervals(day.upNext!)).toMatchObject({ kind: 'intervals', reps: 4, workSeconds: 180 })
    expect(day.upNext!.blocks.find((b) => b.main)!.minutes).toBe(16)
    // Threshold's two reps go to one; Strength, with nothing to swap or cut, stays as written.
    const threshold = day.bucket.find((e) => e.session.id === 'threshold')!.session
    expect(threshold.headline).toBe('1 × 12′')
    expect(day.bucket.find((e) => e.session.id === 'strength')!.session).toEqual(prescribedWeek(program, 3, [], [])!.sessions[1])
  })

  it('make every Session easy low-impact work or rest at pain 5 or more', () => {
    for (const score of [5, 8, 10]) {
      const report = pain('2026-11-11', score, { area: 'knee' })
      const day = withPain('2026-11-11', [report], [painDecision(report, 'accepted')])
      expect(painOf(day)[0]).toMatchObject({ level: 'low-impact', trigger: { score, area: 'knee' } })
      expect(day.bucket.map((e) => e.session.headline)).toEqual([
        'easy bike 30′ or rest',
        'easy bike 30′ or rest',
        'easy bike 30′ or rest',
        'easy bike 30′ or rest',
        'easy bike 25′ or rest',
      ])
      expect(day.bucket.map((e) => e.session.type)).toEqual(['speed', 'strength', 'threshold', 'hyrox', 'easy'])
      expect(day.upNext!.blocks).toHaveLength(1)
      expect(mainIntervals(day.upNext!)).toEqual({ kind: 'note', minutes: 30 })
      // Nothing left to run, lift or push: Log after, not Start session.
      expect(day.bucket.map((e) => isLive(e.session))).toEqual([false, false, false, false, false])
    }
  })

  it('apply to a Session of another Week done today, early or late, and only then', () => {
    const report = pain('2026-11-11', 4)
    const decisions = [painDecision(report, 'accepted')]
    const reports = { reports: [report], today: localDate('2026-11-11') }
    const asWritten = (week: number) => prescribedWeek(program, week, [], decisions)!
    const withPainToday = (week: number, doneToday: boolean) =>
      prescribedWeek(program, week, [], decisions, undefined, { ...reports, doneToday })!
    expect(withPainToday(5, false)).toEqual(asWritten(5))
    for (const week of [1, 5]) {
      const names = (w: ReturnType<typeof asWritten>) => w.sessions[0].blocks.flatMap((b) => b.exercises.map((e) => e.name))
      expect(names(asWritten(week))).toContain('Accelerations')
      expect(names(withPainToday(week, true))).not.toContain('Accelerations')
    }
  })

  it('count rising pain, higher than the report before, as pain 3', () => {
    const before = pain('2026-11-10', 1)
    const rising = pain('2026-11-11', 2)
    const day = withPain('2026-11-11', [before, rising])
    expect(painOf(day)[0]).toMatchObject({ id: `pain-${rising.id}`, level: 'ease', trigger: { score: 2, risingFrom: 1 } })

    expect(painOf(withPain('2026-11-11', [pain('2026-11-10', 2), pain('2026-11-11', 2)]))).toEqual([])
    expect(painOf(withPain('2026-11-11', [pain('2026-11-10', 2), pain('2026-11-11', 1)]))).toEqual([])
    // Rising from no pain at all is still rising.
    expect(painOf(withPain('2026-11-11', [pain('2026-11-10', 0), pain('2026-11-11', 1)]))[0]).toMatchObject({
      level: 'ease',
      trigger: { risingFrom: 0 },
    })
  })

  it('compare reports given the same day in the order they were given', () => {
    const morning = pain('2026-11-11', 1, { at: '11:00' })
    const evening = pain('2026-11-11', 2, { at: '22:00' })
    expect(painOf(withPain('2026-11-11', [evening, morning]))[0]).toMatchObject({ trigger: { risingFrom: 1 } })
  })

  it('end when the next report says No', () => {
    const report = pain('2026-11-10', 6)
    const day = withPain('2026-11-11', [report, pain('2026-11-11', 0)], [painDecision(report, 'accepted')])
    expect(painOf(day)).toEqual([])
    expect(day.upNext).toBe(findWeek(program, 3)!.sessions[0])
  })

  it('stand until the next report, Accepted or not', () => {
    const report = pain('2026-11-09', 4)
    const day = withPain('2026-11-12', [report], [painDecision(report, 'accepted')])
    expect(painOf(day)[0]).toMatchObject({ date: '2026-11-09', decision: 'accepted', decidedOn: '2026-11-09' })
    expect(day.upNext).toMatchObject({ headline: '4 × 3′' })
  })

  it('ignore a report from a later day', () => {
    expect(painOf(withPain('2026-11-11', [pain('2026-11-12', 7)]))).toEqual([])
  })

  describe('a next-morning report after a Session', () => {
    // Speed done on Tuesday after saying 2 at Start; Wednesday morning, Something hurts.
    const atStart = pain('2026-11-10', 2, { session: [3, 'speed'], at: '22:00' })
    const speedDone = log(3, 'speed', '2026-11-10')

    it('applies the rules from that morning when it reaches 3', () => {
      const morning = pain('2026-11-11', 3)
      const day = withPain('2026-11-11', [atStart, morning], [painDecision(morning, 'accepted')], [speedDone])
      expect(painOf(day)[0]).toMatchObject({ date: '2026-11-11', level: 'ease', trigger: { score: 3, risingFrom: 2 } })
      expect(day.bucket.find((e) => e.session.id === 'threshold')!.session.headline).toBe('1 × 12′')
    })

    it('counts as rising when it is higher than the report at Start, even under 3', () => {
      const lower = pain('2026-11-10', 1, { session: [3, 'speed'], at: '22:00' })
      const morning = pain('2026-11-11', 2)
      const day = withPain('2026-11-11', [lower, morning], [], [speedDone])
      expect(painOf(day)[0]).toMatchObject({ level: 'ease', trigger: { score: 2, risingFrom: 1 } })
    })

    it('leaves the Session already logged as it was written', () => {
      const morning = pain('2026-11-11', 6)
      const day = withPain('2026-11-11', [atStart, morning], [painDecision(morning, 'accepted')], [speedDone])
      expect(day.bucket.find((e) => e.session.id === 'speed')!.session).toBe(findWeek(program, 3)!.sessions[0])
      expect(day.bucket.find((e) => e.session.id === 'hyrox')!.session.headline).toBe('easy bike 30′ or rest')
    })
  })

  it('leave the race alone', () => {
    const report = pain('2027-04-21', 7)
    const day = withPain('2027-04-21', [report], [painDecision(report, 'accepted')])
    expect(day.upNext).toMatchObject({ id: 'race', headline: findWeek(program, 26)!.sessions.find((s) => s.id === 'race')!.headline })
  })

  it('apply to a carried Key session still open', () => {
    // Week 3's Threshold (Key) carried into Week 4, Monday.
    const logs = ['speed', 'strength', 'hyrox'].map((id) => log(3, id, '2026-11-10'))
    const report = pain('2026-11-16', 4)
    const day = coach({
      program,
      today: localDate('2026-11-16'),
      logs: [...keysDoneBefore(localDate('2026-11-09')), ...logs],
      painReports: [report],
      decisions: [painDecision(report, 'accepted')],
    })
    expect(day.bucket[0]).toMatchObject({ week: 3, carriedUntil: '2026-11-18', session: { id: 'threshold', headline: '1 × 12′' } })
  })

  it('show on other screens for the Week holding today only', () => {
    const report = pain('2026-11-11', 4)
    const decisions = [painDecision(report, 'accepted')]
    const today = localDate('2026-11-11')
    expect(prescribedWeek(program, 3, [], decisions, undefined, { reports: [report], today })?.sessions[0].headline).toBe('4 × 3′')
    expect(prescribedWeek(program, 4, [], decisions, undefined, { reports: [report], today })).toEqual(prescribedWeek(program, 4, [], []))
    expect(prescribedWeek(program, 3, [], decisions)).toEqual(prescribedWeek(program, 3, [], []))
  })
})

// ---------------------------------------------------------------------------
// Recovery data (docs/training-plan.md, Rules, 3).

/** A night ending on the morning of `iso`: 7 h 30 and HRV 52 unless said otherwise. */
const night = (iso: string, sleepMinutes = 450, hrvMs: number | null = 52): RecoveryNight => ({
  date: localDate(iso),
  sleepMinutes,
  hrvMs,
  restingHeartRate: 48,
  source: 'Ultrahuman',
  receivedAt: `${iso}T12:00:00.000Z`,
})

/** A normal week of nights before Wednesday 11 November: HRV averaging 52. */
const baseline = ['2026-11-04', '2026-11-05', '2026-11-06', '2026-11-07', '2026-11-08', '2026-11-09', '2026-11-10'].map(
  (iso, i) => night(iso, 450, [50, 54, 52, 51, 53, 52, 52][i]),
)

function withNights(
  iso: string,
  recoveryNights: RecoveryNight[],
  decisions: SuggestionDecision[] = [],
  logs: SessionLog[] = [],
) {
  return coach({ program, today: localDate(iso), logs: [...keysDoneBefore(localDate(iso)), ...logs], decisions, recoveryNights })
}

const recoveryOf = (day: ReturnType<typeof coach>) => day.suggestions.filter((s) => s.kind === 'recovery')

const recoveryDecision = (decision: Decision): SuggestionDecision => ({
  id: 'recovery-2026-11-11',
  decision,
  date: localDate('2026-11-11'),
  updatedAt: '2026-11-11T13:00:00.000Z',
})

describe('the recovery rules', () => {
  const asWritten = findWeek(program, 3)!.sessions[0]

  it('change nothing without a night for today', () => {
    for (const nights of [[], baseline, [night('2026-11-10', 300, 30)]]) {
      const day = withNights('2026-11-11', nights)
      expect(day.upNext).toBe(asWritten)
      expect(day.recovery).toBeNull()
      expect(day.recoveryChange).toBeNull()
      expect(recoveryOf(day)).toEqual([])
    }
  })

  it('change nothing after 6 hours of sleep or more, whatever HRV does', () => {
    for (const sleep of [360, 480]) {
      const day = withNights('2026-11-11', [...baseline, night('2026-11-11', sleep, 30)])
      expect(day.upNext).toBe(asWritten)
      expect(day.recovery).toMatchObject({ shortSleep: false, easyDay: false, hrvMean: 52 })
      expect(recoveryOf(day)).toEqual([])
    }
  })

  it('take one rep off and cap RPE at 7 for a Hard session after under 6 hours', () => {
    const day = withNights('2026-11-11', [...baseline, night('2026-11-11', 341, 50)])
    expect(day.recoveryChange).toBe('short-sleep')
    expect(day.recoveryCut).toBe('rep')
    expect(day.upNext).toMatchObject({ id: 'speed', headline: '4 × 3′', minutes: asWritten.minutes - 4 })
    expect(day.upNext!.note).toMatch(/^Short sleep \(5 h 41\): one rep fewer, nothing past RPE 7\./)
    expect(mainIntervals(day.upNext!)).toMatchObject({ kind: 'intervals', reps: 4, workSeconds: 180 })
    const efforts = day.upNext!.blocks
      .filter((b) => b.main)
      .flatMap((b) => b.exercises)
      .flatMap((e) => ('effort' in e.prescription && e.prescription.effort?.rpe ? [e.prescription.effort.rpe] : []))
    for (const [, high] of efforts) expect(high).toBeLessThanOrEqual(7)
    // Up next only: the rest of the Bucket stays as written.
    expect(day.bucket.find((e) => e.session.id === 'threshold')!.session).toBe(findWeek(program, 3)!.sessions[2])
    expect(day.bucket.find((e) => e.state === 'next')!.session).toBe(day.upNext)
    // HRV normal: no Suggestion.
    expect(recoveryOf(day)).toEqual([])
  })

  it('take a set off every main lift and cap its sets at RPE 7 on a Strength day', () => {
    const speedYesterday: SessionLog = {
      ...keysDoneBefore(localDate('2026-11-11'))[0],
      id: 'speed-w3',
      week: 3,
      sessionId: 'speed',
      date: localDate('2026-11-10'),
    }
    const day = withNights('2026-11-11', [...baseline, night('2026-11-11', 300)], [], [speedYesterday])
    expect(day.upNext!.type).toBe('strength')
    expect(day.recoveryCut).toBe('set')
    const written = findWeek(program, 3)!.sessions.find((s) => s.id === day.upNext!.id)!
    const sets = (s: typeof written) =>
      s.blocks.filter((b) => b.main).flatMap((b) => b.exercises.map((e) => e.prescription)).filter((rx) => rx.kind === 'sets')
    const before = sets(written)
    const after = sets(day.upNext!)
    expect(after.length).toBeGreaterThan(0)
    after.forEach((rx, i) => {
      const was = before[i]
      if (rx.kind !== 'sets' || was.kind !== 'sets') throw new Error('not sets')
      expect(rx.sets).toBe(Math.max(1, was.sets - 1))
      expect(rx.reps).toEqual(was.reps)
      expect(rx.rpeCap).toBeLessThanOrEqual(7)
      if (rx.rpe) expect(rx.rpe[1]).toBeLessThanOrEqual(7)
    })
  })

  it('take the last round off a picked HYROX session, and say so on its Suggestion', () => {
    const day = coach({
      program,
      today: localDate('2026-11-11'),
      logs: keysDoneBefore(localDate('2026-11-11')),
      picked: { date: localDate('2026-11-11'), week: 3, sessionId: 'hyrox' },
      recoveryNights: [...baseline, night('2026-11-11', 320, 40)],
    })
    expect(day.upNext!.type).toBe('hyrox')
    expect(day.recoveryCut).toBe('round')
    expect(day.upNext!.blocks.filter((b) => b.main).map((b) => b.name)).toEqual(['Round 1', 'Round 2'])
    expect(recoveryOf(day)[0]).toMatchObject({ sessionId: 'hyrox', cut: 'round' })
  })

  it('leave an Easy run alone', () => {
    const easyOnly = findWeek(program, 3)!.sessions
      .filter((s) => s.type !== 'easy')
      .map((s, i) => ({ ...keysDoneBefore(localDate('2026-11-11'))[0], id: `w3-${i}`, week: 3, sessionId: s.id, date: localDate('2026-11-09') }))
    const day = withNights('2026-11-11', [...baseline, night('2026-11-11', 300, 30)], [], easyOnly)
    expect(day.upNext!.type).toBe('easy')
    expect(day.upNext).toBe(findWeek(program, 3)!.sessions.find((s) => s.type === 'easy'))
    expect(day.recoveryChange).toBeNull()
    expect(recoveryOf(day)).toEqual([])
  })

  it('suggest an easy day when HRV is at least 15% under its 7-night mean as well', () => {
    // 44 is 15.4% under 52.
    const day = withNights('2026-11-11', [...baseline, night('2026-11-11', 341, 44)])
    expect(recoveryOf(day)).toEqual([
      {
        id: 'recovery-2026-11-11',
        kind: 'recovery',
        week: 3,
        sessionId: 'speed',
        date: '2026-11-11',
        cut: 'rep',
        trigger: { sleepMinutes: 341, hrvMs: 44, hrvMean: 52 },
        decision: 'open',
        decidedOn: null,
      },
    ])
    // Until it's Accepted, the short-sleep rule stands.
    expect(day.recoveryChange).toBe('short-sleep')
    expect(day.upNext!.headline).toBe('4 × 3′')
  })

  it('raise no Suggestion for HRV only 14% under, or for low HRV after a full night', () => {
    expect(recoveryOf(withNights('2026-11-11', [...baseline, night('2026-11-11', 341, 45)]))).toEqual([])
    expect(recoveryOf(withNights('2026-11-11', [...baseline, night('2026-11-11', 420, 30)]))).toEqual([])
  })

  it('raise no Suggestion without HRV, or with fewer than 3 nights to average', () => {
    expect(recoveryOf(withNights('2026-11-11', [...baseline, night('2026-11-11', 300, null)]))).toEqual([])
    const day = withNights('2026-11-11', [...baseline.slice(-2), night('2026-11-11', 300, 20)])
    expect(day.recovery).toMatchObject({ hrvMean: null, easyDay: false })
    expect(recoveryOf(day)).toEqual([])
    expect(day.recoveryChange).toBe('short-sleep')
  })

  it('only average the 7 nights before the morning', () => {
    const old = night('2026-11-03', 450, 200)
    expect(withNights('2026-11-11', [old, ...baseline, night('2026-11-11', 341, 44)]).recovery?.hrvMean).toBe(52)
  })

  it('make the Hard session an easy 30′ once the Suggestion is Accepted, and only then', () => {
    const nights = [...baseline, night('2026-11-11', 341, 44)]
    const accepted = withNights('2026-11-11', nights, [recoveryDecision('accepted')])
    expect(accepted.recoveryChange).toBe('easy-day')
    expect(accepted.upNext).toMatchObject({ id: 'speed', type: 'speed', headline: 'easy 30′ or rest', minutes: 30 })
    expect(recoveryOf(accepted)[0]).toMatchObject({ decision: 'accepted', decidedOn: '2026-11-11' })

    const kept = withNights('2026-11-11', nights, [recoveryDecision('kept')])
    expect(kept.recoveryChange).toBe('short-sleep')
    expect(kept.upNext!.headline).toBe('4 × 3′')
  })

  it('apply to today only: tomorrow without a night is as written', () => {
    const day = withNights('2026-11-12', [...baseline, night('2026-11-11', 300, 30)], [recoveryDecision('accepted')])
    expect(day.recovery).toBeNull()
    expect(day.recoveryChange).toBeNull()
    expect(recoveryOf(day)).toEqual([])
  })

  it('leave Race day as it is', () => {
    const raceDay = localDate('2027-04-21')
    const day = withNights(raceDay, [
      night('2027-04-18', 450, 52),
      night('2027-04-19', 450, 52),
      night('2027-04-20', 450, 52),
      night(raceDay, 240, 30),
    ])
    expect(day.upNext?.date).toBe(raceDay)
    expect(day.recoveryChange).toBeNull()
    expect(recoveryOf(day)).toEqual([])
  })
})

describe('Activities', () => {
  const run = (start: string, end: string) =>
    parseActivity({ type: 'Running', start, end, distanceKm: 8, heartRates: '150\n160' }, '2026-11-12T12:00:00.000Z')
  const today = localDate('2026-11-11')
  const base = { program, today, logs: keysDoneBefore(today) }

  it('attaches the watch’s workout to the Session logged that day, on its Bucket row', () => {
    const activity = run('2026-11-11T07:00:00-05:00', '2026-11-11T07:45:00-05:00')
    const day = coach({ ...base, logs: [...base.logs, log(3, 'speed', '2026-11-11')], activities: [activity] })
    expect(day.bucket.find((e) => e.session.id === 'speed')?.activity).toEqual(activity)
    expect(day.bucket.filter((e) => e.activity)).toHaveLength(1)
    expect(day.activityQuestions).toEqual([])
  })

  it('asks which Session a run was while three run Sessions are Planned, until the athlete answers', () => {
    const activity = run('2026-11-11T07:00:00-05:00', '2026-11-11T07:45:00-05:00')
    const day = coach({ ...base, activities: [activity] })
    expect(day.activityQuestions.map((q) => q.candidates.map((c) => c.session.id))).toEqual([['speed', 'threshold', 'easy']])
    const answered = coach({
      ...base,
      activities: [activity],
      activityAnswers: [{ activityId: activity.id, week: 3, sessionId: 'threshold', updatedAt: '2026-11-11T13:00:00.000Z' }],
    })
    expect(answered.activityQuestions).toEqual([])
    expect(answered.bucket.find((e) => e.session.id === 'threshold')?.activity?.id).toBe(activity.id)
  })

  it('offers to log a Session the athlete attached a workout to, until it is logged', () => {
    const activity = run('2026-11-10T07:00:00-05:00', '2026-11-10T07:45:00-05:00')
    const activityAnswers = [{ activityId: activity.id, week: 3, sessionId: 'threshold', updatedAt: '2026-11-11T13:00:00.000Z' }]
    const answered = coach({ ...base, activities: [activity], activityAnswers })
    expect(answered.activitiesAttached).toMatchObject([{ sessionId: 'threshold', by: 'athlete', logged: false }])
    expect(answered.bucket.find((e) => e.session.id === 'threshold')?.state).not.toBe('done')
    const logged = coach({ ...base, logs: [...base.logs, log(3, 'threshold', '2026-11-10')], activities: [activity], activityAnswers })
    expect(logged.activitiesAttached).toEqual([])
  })

  it('says what it attached on its own today, logged or not', () => {
    const activity = run('2026-11-11T07:00:00-05:00', '2026-11-11T07:45:00-05:00')
    const day = coach({ ...base, logs: [...base.logs, log(3, 'speed', '2026-11-11')], activities: [activity] })
    expect(day.activitiesAttached).toMatchObject([{ sessionId: 'speed', by: 'coach', logged: true }])
  })

  it('stops asking about a workout a week old', () => {
    const activity = run('2026-11-09T07:00:00-05:00', '2026-11-09T07:45:00-05:00')
    expect(coach({ ...base, today: localDate('2026-11-15'), activities: [activity] }).activityQuestions).toHaveLength(1)
    expect(coach({ ...base, today: localDate('2026-11-16'), activities: [activity] }).activityQuestions).toEqual([])
  })
})
