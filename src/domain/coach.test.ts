import { describe, expect, it } from 'vitest'
import { daysBetween, isoWeekday, localDate, localDateIn, type LocalDate } from './calendar'
import { DEFAULT_EQUIPMENT, equipWeek } from './equipment'
import { coach, findWeek, prescribedWeek, programStart, weekOutcome, type CoachInput } from './coach'
import { parseActivity } from './activity'
import { isLive } from './lifts'
import type { LoggedStatus, SessionLog } from './log'
import type { PainArea, PainReport } from './pain'
import { program } from './program/program'
import type { RecoveryNight } from './recovery'
import type { Program, Session } from './program/types'
import type { Decision, SuggestionDecision } from './suggestion'

/**
 * Every Week before `today` cleared on its Monday: the Key session done, the
 * other required Sessions Swapped, so nothing is Late (and no Working weight
 * moves), too long ago to touch the spacing rules.
 */
function caughtUpBefore(today: LocalDate, p: Program = program): SessionLog[] {
  return p.phases
    .flatMap((phase) => phase.weeks)
    .filter((week) => daysBetween(week.startDate, today) >= 7)
    .flatMap((week) =>
      week.sessions
        .filter((s) => !s.optional && !s.date)
        .map((s) => ({
          id: `key-${week.number}-${s.id}`,
          week: week.number,
          sessionId: s.id,
          date: week.startDate,
          status: s.key ? ('done' as const) : ('swapped' as const),
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
          updatedAt: '2026-10-22T12:00:00.000Z',
        })),
    )
}

const on = (iso: string, p: Program = program) =>
  coach({ program: p, today: localDate(iso), logs: caughtUpBefore(localDate(iso), p) })
/** What the Coach says at an exact instant, read on a clock in Toronto. */
const at = (instant: string) => coach({ program, today: localDateIn(new Date(instant)) })

const weekOf = (day: ReturnType<typeof coach>) =>
  day.position.kind === 'in-week' ? day.position.week : day.position.kind

describe('the Program calendar', () => {
  it('starts Week 1 on Monday 9 November 2026', () => {
    expect(programStart(program)).toBe('2026-11-09')
    expect(isoWeekday(programStart(program))).toBe(1)

    const day = on('2026-11-09')
    expect(day.position).toEqual({
      kind: 'in-week',
      week: 1,
      phase: 'foundation',
      startDate: '2026-11-09',
      endDate: '2026-11-15',
      daysLeft: 7,
    })
  })

  it('puts Race day, Thursday 22 April 2027, in Week 24', () => {
    expect(isoWeekday(program.raceDay)).toBe(4)
    const day = on('2027-04-22')
    expect(day.position).toMatchObject({ kind: 'in-week', week: 24, phase: 'taper', startDate: '2027-04-19' })
  })

  it('dates every encoded Week to the Monday the calendar gives it', () => {
    for (const phase of program.phases) {
      for (const week of phase.weeks) {
        expect(on(week.startDate).position).toMatchObject({ week: week.number, startDate: week.startDate })
      }
    }
  })

  it('runs Weeks Monday to Sunday', () => {
    expect(on('2026-11-15').position).toMatchObject({ week: 1, daysLeft: 1 })
    expect(on('2026-11-16').position).toMatchObject({ week: 2, daysLeft: 7 })
    expect(on('2026-11-25').position).toMatchObject({ week: 3, daysLeft: 5 })
  })

  it('is before the Program until Week 1 and finished after Week 24', () => {
    expect(on('2026-11-03').position).toEqual({ kind: 'before-start', startsOn: '2026-11-09', daysToStart: 6 })
    expect(on('2026-11-08').position).toEqual({ kind: 'before-start', startsOn: '2026-11-09', daysToStart: 1 })
    expect(on('2027-04-25').position).toMatchObject({ kind: 'in-week', week: 24, daysLeft: 1 })
    expect(on('2027-04-26').position).toEqual({ kind: 'finished' })
  })
})

describe('Week boundaries in America/Toronto', () => {
  it('turns the Week at midnight in Toronto, not in UTC', () => {
    // Sunday 22 Nov, 23:59:59 EST is already Monday in UTC.
    expect(weekOf(at('2026-11-23T04:59:59Z'))).toBe(2)
    expect(weekOf(at('2026-11-23T05:00:00Z'))).toBe(3)
  })

  it('starts the Program at midnight in Toronto, in EST since clocks fell back on 1 November', () => {
    expect(weekOf(at('2026-11-09T04:59:59Z'))).toBe('before-start')
    expect(weekOf(at('2026-11-09T05:00:00Z'))).toBe(1)
  })

  it('keeps the boundary at local midnight after clocks spring forward on 14 March', () => {
    // Monday 15 March 2027 is Week 19; EDT again, so midnight is 04:00 UTC.
    expect(weekOf(at('2027-03-15T03:59:59Z'))).toBe(18)
    expect(weekOf(at('2027-03-15T04:00:00Z'))).toBe(19)
  })
})

describe('days to Race day', () => {
  it.each([
    ['2026-11-03', 170],
    ['2026-11-09', 164],
    ['2026-11-25', 148],
    ['2027-03-13', 40],
    ['2027-03-15', 38],
    ['2027-04-21', 1],
    ['2027-04-22', 0],
    ['2027-04-23', -1],
  ])('on %s is %i', (iso, days) => {
    expect(on(iso).daysToRace).toBe(days)
  })

  it('counts calendar days in Toronto, whatever the hour', () => {
    expect(at('2027-04-22T03:59:59Z').daysToRace).toBe(1)
    expect(at('2027-04-22T04:00:00Z').daysToRace).toBe(0)
  })
})

describe('Phase completion', () => {
  const completion = (iso: string) =>
    Object.fromEntries(on(iso).phases.map((p) => [p.id, p.completion]))
  const current = (iso: string) => on(iso).phases.filter((p) => p.current).map((p) => p.id)

  it('lists all four Phases in order', () => {
    expect(on('2026-11-25').phases.map((p) => p.name)).toEqual(['Foundation', 'Build', 'Race specific', 'Taper'])
  })

  it('counts the Weeks of the current Phase already behind today', () => {
    expect(completion('2026-11-25')).toEqual({ foundation: 2 / 5, build: 0, 'race-specific': 0, taper: 0 })
    expect(current('2026-11-25')).toEqual(['foundation'])
  })

  it('fills earlier Phases once the next one starts', () => {
    expect(completion('2026-12-14')).toMatchObject({ foundation: 1, build: 0 })
    expect(current('2026-12-14')).toEqual(['build'])
    expect(completion('2027-04-22')).toMatchObject({ 'race-specific': 1, taper: 2 / 3 })
  })

  it('is empty before the Program and full after it', () => {
    expect(Object.values(completion('2026-11-03'))).toEqual([0, 0, 0, 0])
    expect(current('2026-11-03')).toEqual([])
    expect(Object.values(completion('2027-05-01'))).toEqual([1, 1, 1, 1])
    expect(current('2027-05-01')).toEqual([])
  })
})

describe('Up next', () => {
  it("is the first planned Session in the current Week's Bucket", () => {
    expect(on('2026-11-09').upNext).toMatchObject({ id: 'hyrox-a', name: 'HYROX A', headline: '4 rounds' })
    expect(on('2026-11-15').upNext).toMatchObject({ id: 'hyrox-a' })
    expect(on('2026-11-25').upNext).toMatchObject({ id: 'hyrox-a', key: true })
  })

  it('shows the current Week as the Bucket', () => {
    const day = on('2026-11-25')
    expect(day.week?.number).toBe(3)
    expect(day.week?.sessions.map((s) => s.id)).toEqual(['hyrox-a', 'hyrox-b', 'run', 'strength', 'easy'])
  })

  it('holds the Compromised run test as the Key session of a test Week, in the Run’s place', () => {
    const day = on('2026-11-18')
    expect(day.week?.sessions.map((s) => s.id)).toEqual(['hyrox-a', 'hyrox-b', 'compromised-run-test', 'strength', 'easy'])
    expect(day.week?.sessions.find((s) => s.key)?.id).toBe('compromised-run-test')
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
    expect(on('2026-11-09', easyFirst).week?.sessions[0].optional).toBe(true)
    expect(on('2026-11-09', easyFirst).upNext?.optional).toBe(false)
  })

  it('waits for Monday before the Program starts, showing Week 1 ahead', () => {
    const day = on('2026-11-08')
    expect(day.upNext).toBeNull()
    expect(day.week?.number).toBe(1)
  })

  it('is the race in Race week, and empty after the Program', () => {
    expect(on('2027-04-22').upNext).toMatchObject({ id: 'race', date: '2027-04-22', key: true })

    expect(on('2027-05-01').week).toBeNull()
    expect(on('2027-05-01').upNext).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// With Session logs. Week 3 runs Mon 23 – Sun 29 Nov: HYROX A (Key), HYROX B,
// the Run (Threshold 3 × 8′), Strength, Easy run (Optional). HYROX and
// Strength load the legs; the Run is never the day after either.

let nextId = 0
function log(week: number, sessionId: string, date: string, status: LoggedStatus = 'done', updatedAt = '2026-11-22T12:00:00.000Z'): SessionLog {
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
  coach({ program, today: localDate(iso), logs: [...caughtUpBefore(localDate(iso)), ...logs], picked })
const states = (day: ReturnType<typeof coach>) => Object.fromEntries(day.bucket.map((e) => [e.session.id, e.state]))

describe('the Bucket', () => {
  it('is Next for Up next and Planned for the rest while nothing is logged', () => {
    expect(states(on('2026-11-25'))).toEqual({
      'hyrox-a': 'next',
      'hyrox-b': 'planned',
      run: 'planned',
      strength: 'planned',
      easy: 'planned',
    })
  })

  it('shows each logged Session as Done, Partial, Skipped or Swapped, with its log', () => {
    const logs = [
      log(3, 'hyrox-a', '2026-11-23', 'done'),
      log(3, 'hyrox-b', '2026-11-23', 'partial'),
      // Skipped today, so not offered again until tomorrow.
      log(3, 'run', '2026-11-25', 'skipped'),
      log(3, 'strength', '2026-11-24', 'swapped'),
    ]
    const day = withLogs('2026-11-25', logs)
    expect(states(day)).toEqual({ 'hyrox-a': 'done', 'hyrox-b': 'partial', run: 'skipped', strength: 'swapped', easy: 'next' })
    expect(day.bucket[0].log).toBe(logs[0])
    expect(day.bucket[4].log).toBeNull()
  })

  it('goes by the latest edit when a Session has more than one log', () => {
    const logs = [
      log(3, 'hyrox-a', '2026-11-23', 'done', '2026-11-23T20:00:00.000Z'),
      log(3, 'hyrox-a', '2026-11-23', 'partial', '2026-11-24T08:00:00.000Z'),
    ]
    expect(states(withLogs('2026-11-25', logs))['hyrox-a']).toBe('partial')
  })

  it('ignores logs from other Weeks', () => {
    expect(states(withLogs('2026-11-25', [log(2, 'strength', '2026-11-17')])).strength).toBe('planned')
  })

  it('shows Week 1 all Planned before the Program starts', () => {
    expect(new Set(Object.values(states(on('2026-11-03'))))).toEqual(new Set(['planned']))
  })

  it('is empty after the Program', () => {
    expect(on('2027-05-01').bucket).toEqual([])
  })
})

describe('Up next with Session logs', () => {
  it('moves past logged Sessions to the oldest-waiting one, in Bucket order', () => {
    const day = withLogs('2026-11-25', [log(3, 'hyrox-a', '2026-11-23')])
    expect(day.upNext?.id).toBe('hyrox-b')
    expect(day.rest).toBeNull()
  })

  it('moves past Skipped and Swapped Sessions too', () => {
    const logs = [log(3, 'hyrox-a', '2026-11-23', 'skipped'), log(3, 'hyrox-b', '2026-11-23', 'swapped')]
    expect(withLogs('2026-11-25', logs).upNext?.id).toBe('run')
  })

  describe('a Skipped Session while the Week has days left', () => {
    const rest = [log(3, 'hyrox-a', '2026-11-23'), log(3, 'hyrox-b', '2026-11-24'), log(3, 'run', '2026-11-26')]

    it('comes back as Up next once nothing untouched is left', () => {
      const day = withLogs('2026-11-28', [...rest, log(3, 'strength', '2026-11-25', 'skipped')])
      expect(day.upNext?.id).toBe('strength')
      expect(day.rest).toBeNull()
      expect(states(day).strength).toBe('next')
    })

    it('still counts as to do in the Bucket', () => {
      const day = withLogs('2026-11-28', [...rest, log(3, 'strength', '2026-11-25', 'skipped')])
      expect(day.bucket.filter((e) => e.toDo).map((e) => e.session.id)).toEqual(['strength', 'easy'])
    })

    it('waits behind Sessions not logged at all', () => {
      const day = withLogs('2026-11-28', [rest[0], rest[1], log(3, 'run', '2026-11-25', 'skipped')])
      expect(day.upNext?.id).toBe('strength')
      const later = withLogs('2026-11-27', [rest[0], log(3, 'hyrox-b', '2026-11-24', 'skipped')])
      expect(later.upNext?.id).toBe('run')
    })

    it('is not offered again the day it was Skipped', () => {
      const logs = [...rest, log(3, 'easy', '2026-11-27'), log(3, 'strength', '2026-11-28', 'skipped')]
      const day = withLogs('2026-11-28', logs)
      expect(day.upNext).toBeNull()
      expect(day.rest).toMatchObject({ kind: 'skipped-today', lastDay: false })
      expect(withLogs('2026-11-29', logs).upNext?.id).toBe('strength')
    })

    it('closes the Week with a miss when Skipped on Sunday', () => {
      const logs = [...rest, log(3, 'easy', '2026-11-27'), log(3, 'strength', '2026-11-29', 'skipped')]
      const day = withLogs('2026-11-29', logs)
      expect(day.rest).toMatchObject({ kind: 'skipped-today', lastDay: true })
      expect(day.rest?.kind === 'skipped-today' && day.rest.sessions.map((s) => s.id)).toEqual(['strength'])
    })

    it('can be picked to do today', () => {
      const day = withLogs('2026-11-28', [...rest, log(3, 'strength', '2026-11-28', 'skipped')], {
        date: localDate('2026-11-28'),
        week: 3,
        sessionId: 'strength',
      })
      expect(day.upNext?.id).toBe('strength')
    })

    it('gives way to the Week done once it is made up', () => {
      const logs = [
        ...rest,
        log(3, 'easy', '2026-11-27'),
        log(3, 'strength', '2026-11-25', 'skipped', '2026-11-25T12:00:00.000Z'),
        log(3, 'strength', '2026-11-28', 'done', '2026-11-28T12:00:00.000Z'),
      ]
      expect(withLogs('2026-11-28', logs).rest).toEqual({ kind: 'week-done' })
    })
  })

  it('is never Week done while a required Session is Skipped', () => {
    const logs = ['hyrox-a', 'hyrox-b', 'run', 'easy'].map((id) => log(3, id, '2026-11-23'))
    const day = withLogs('2026-11-26', [...logs, log(3, 'strength', '2026-11-24', 'skipped')])
    expect(day.rest).not.toEqual({ kind: 'week-done' })
    expect(day.upNext?.id).toBe('strength')
  })

  it('is Week done with the Optional session Skipped: missing it is not a miss', () => {
    const logs = ['hyrox-a', 'hyrox-b', 'run', 'strength'].map((id) => log(3, id, '2026-11-23'))
    const day = withLogs('2026-11-26', [...logs, log(3, 'easy', '2026-11-24', 'skipped')])
    expect(day.rest).toEqual({ kind: 'week-done' })
  })

  describe('no two Hard sessions on consecutive days when avoidable', () => {
    it('rests the day after a Hard session when the Week can still fit the rest', () => {
      // Thursday: the Run and Strength left, four days to fit them in.
      const day = withLogs('2026-11-26', [log(3, 'hyrox-a', '2026-11-23'), log(3, 'hyrox-b', '2026-11-25')])
      expect(day.upNext).toBeNull()
      expect(day.rest).toMatchObject({ kind: 'hard-yesterday', anyway: { week: 3, session: { id: 'strength' } } })
    })

    it('goes Hard anyway when resting would leave too few days', () => {
      // Wednesday: HYROX B, the Run and Strength left in five days. Resting today
      // leaves four, which hold only two Hard sessions apart.
      const day = withLogs('2026-11-25', [log(3, 'hyrox-a', '2026-11-24')])
      expect(day.upNext?.id).toBe('hyrox-b')
    })

    it('stops at one Hard session a day when the Week has room', () => {
      const day = withLogs('2026-11-23', [log(3, 'hyrox-a', '2026-11-23')])
      expect(day.upNext).toBeNull()
      expect(day.rest).toMatchObject({ kind: 'hard-today', anyway: { week: 3, session: { id: 'hyrox-b' } } })
    })

    it('allows a second Hard session today when the Week runs out otherwise', () => {
      const logs = [log(3, 'hyrox-a', '2026-11-23'), log(3, 'hyrox-b', '2026-11-25'), log(3, 'run', '2026-11-29')]
      expect(withLogs('2026-11-29', logs).upNext?.id).toBe('strength')
    })

    it('counts the Hard day before Monday across the Week boundary', () => {
      // Strength done Sunday of Week 2; Week 3's HYROX sessions Swapped on Monday,
      // so the Run and Strength are left with six days to fit them.
      const swapped = [log(3, 'hyrox-a', '2026-11-23', 'swapped'), log(3, 'hyrox-b', '2026-11-23', 'swapped')]
      const day = withLogs('2026-11-23', [log(2, 'strength', '2026-11-22'), ...swapped])
      expect(day.upNext).toBeNull()
      expect(day.rest).toMatchObject({ kind: 'hard-yesterday' })
      expect(withLogs('2026-11-23', swapped).upNext?.id).toBe('run')
    })

    it('does not count Skipped or Swapped Sessions as a Hard day', () => {
      const day = withLogs('2026-11-26', [log(3, 'hyrox-a', '2026-11-23'), log(3, 'hyrox-b', '2026-11-25', 'skipped')])
      expect(day.upNext?.id).toBe('run')
    })

    it('counts a Partial Session as a Hard day', () => {
      const day = withLogs('2026-11-26', [log(3, 'hyrox-a', '2026-11-23'), log(3, 'hyrox-b', '2026-11-25', 'partial')])
      expect(day.rest).toMatchObject({ kind: 'hard-yesterday' })
    })
  })

  describe('never the Run the day after HYROX or Strength', () => {
    it('skips the Run for the next Session after Strength yesterday', () => {
      // Thursday, too little room to rest: both HYROX sessions and the Run left in four days.
      const day = withLogs('2026-11-26', [log(3, 'strength', '2026-11-25')])
      expect(day.upNext?.id).toBe('hyrox-a')
    })

    it('skips the Run after HYROX yesterday', () => {
      const day = withLogs('2026-11-27', [log(3, 'hyrox-a', '2026-11-23'), log(3, 'hyrox-b', '2026-11-26')])
      expect(day.upNext?.id).toBe('strength')
    })

    it('treats the Compromised run test as the Run', () => {
      // Week 2's test is left with Strength; HYROX B was done yesterday.
      const day = withLogs('2026-11-20', [log(2, 'hyrox-a', '2026-11-16'), log(2, 'hyrox-b', '2026-11-19')])
      expect(day.upNext?.id).toBe('strength')
    })

    it('rests rather than putting the Run after Strength, even when the Run is all that is left', () => {
      const logs = [log(3, 'hyrox-a', '2026-11-23'), log(3, 'hyrox-b', '2026-11-25'), log(3, 'strength', '2026-11-28')]
      const day = withLogs('2026-11-29', logs)
      expect(day.upNext).toBeNull()
      expect(day.rest).toMatchObject({ kind: 'run-after-load', anyway: { week: 3, session: { id: 'run' } } })
    })

    it('keeps the Run off the same day as Strength too', () => {
      const logs = [log(3, 'hyrox-a', '2026-11-23'), log(3, 'hyrox-b', '2026-11-25'), log(3, 'strength', '2026-11-29')]
      expect(withLogs('2026-11-29', logs).rest).toMatchObject({ kind: 'run-after-load' })
    })

    it('allows the Run the day after an Easy run', () => {
      const logs = [
        log(3, 'hyrox-a', '2026-11-23'),
        log(3, 'hyrox-b', '2026-11-24'),
        log(3, 'strength', '2026-11-25'),
        log(3, 'easy', '2026-11-26'),
      ]
      expect(withLogs('2026-11-27', logs).upNext?.id).toBe('run')
    })
  })

  describe('Strength and an Easy run on the same day', () => {
    it('offers the Optional Easy run after Strength once nothing else is left', () => {
      const logs = [
        log(3, 'hyrox-a', '2026-11-23'),
        log(3, 'hyrox-b', '2026-11-25'),
        log(3, 'run', '2026-11-27'),
        log(3, 'strength', '2026-11-29'),
      ]
      expect(withLogs('2026-11-29', logs).upNext?.id).toBe('easy')
    })
  })

  describe('the Optional session', () => {
    it('is never Up next on a rest day while other Sessions remain', () => {
      const day = withLogs('2026-11-26', [log(3, 'hyrox-a', '2026-11-23'), log(3, 'hyrox-b', '2026-11-25')])
      expect(day.upNext).toBeNull()
    })

    it('is Up next once every other Session is logged', () => {
      const logs = ['hyrox-a', 'hyrox-b', 'run', 'strength'].map((id, i) => log(3, id, `2026-11-${23 + i * 2}`))
      expect(withLogs('2026-11-29', logs).upNext?.id).toBe('easy')
    })

    it('leaves the Week done once it is logged as well', () => {
      const logs = ['hyrox-a', 'hyrox-b', 'run', 'strength', 'easy'].map((id) => log(3, id, '2026-11-23'))
      const day = withLogs('2026-11-29', logs)
      expect(day.upNext).toBeNull()
      expect(day.rest).toEqual({ kind: 'week-done' })
    })
  })

  describe('a suggested rest from the spacing rules', () => {
    const doItAnyway = (day: ReturnType<typeof coach>) => {
      const rest = day.rest!
      if (!('anyway' in rest)) throw new Error(`${rest.kind} is a real rest`)
      return { date: day.today, week: rest.anyway.week, sessionId: rest.anyway.session.id }
    }

    it('names the Session that Do it anyway makes Up next, for today', () => {
      const logs = [log(3, 'hyrox-a', '2026-11-23'), log(3, 'hyrox-b', '2026-11-25')]
      const anyway = doItAnyway(withLogs('2026-11-26', logs))
      expect(withLogs('2026-11-26', logs, anyway).upNext?.id).toBe('strength')
      expect(withLogs('2026-11-26', logs, anyway).rest).toBeNull()
    })

    it('lets the Run go after Strength anyway', () => {
      const logs = [log(3, 'hyrox-a', '2026-11-23'), log(3, 'hyrox-b', '2026-11-25'), log(3, 'strength', '2026-11-28')]
      const anyway = doItAnyway(withLogs('2026-11-29', logs))
      expect(withLogs('2026-11-29', logs, anyway).upNext?.id).toBe('run')
    })

    it('is a suggestion again the next day: tapping past counts only for today', () => {
      const logs = [log(3, 'hyrox-a', '2026-11-23'), log(3, 'hyrox-b', '2026-11-25')]
      const anyway = doItAnyway(withLogs('2026-11-26', logs))
      const friday = withLogs('2026-11-27', [...logs, log(3, 'strength', '2026-11-26')], anyway)
      expect(friday.upNext).toBeNull()
      expect(friday.rest).toMatchObject({ kind: 'run-after-load', anyway: { session: { id: 'run' } } })
    })

    it('leaves the real rests without a way past', () => {
      const done = ['hyrox-a', 'hyrox-b', 'run', 'strength', 'easy'].map((id) => log(3, id, '2026-11-23'))
      expect(withLogs('2026-11-26', done).rest).toEqual({ kind: 'week-done' })
      const skipped = withLogs('2026-11-26', [...done.slice(0, 4), log(3, 'easy', '2026-11-26', 'skipped')])
      expect(skipped.rest).not.toHaveProperty('anyway')
    })
  })

  describe('a Session picked from the Bucket', () => {
    const picked = (sessionId: string, date = '2026-11-25', week = 3) => ({ date: localDate(date), week, sessionId })

    it('becomes Up next, and the previous Up next goes back to Planned', () => {
      const day = withLogs('2026-11-25', [], picked('strength'))
      expect(day.upNext?.id).toBe('strength')
      expect(states(day)).toMatchObject({ 'hyrox-a': 'planned', strength: 'next' })
    })

    it('overrides the spacing rules: the athlete decides', () => {
      const day = withLogs('2026-11-26', [log(3, 'strength', '2026-11-25')], picked('run', '2026-11-26'))
      expect(day.upNext?.id).toBe('run')
    })

    it('can be the Optional session', () => {
      expect(withLogs('2026-11-25', [], picked('easy')).upNext?.id).toBe('easy')
    })

    it('lasts only for the day it was picked', () => {
      expect(withLogs('2026-11-26', [], picked('strength', '2026-11-25')).upNext?.id).toBe('hyrox-a')
    })

    it('gives way once it is logged', () => {
      const day = withLogs('2026-11-25', [log(3, 'run', '2026-11-25')], picked('run'))
      expect(day.upNext?.id).toBe('hyrox-a')
    })

    it('before the Program, makes a Week 1 Session Up next, early', () => {
      const day = withLogs('2026-11-03', [], picked('run', '2026-11-03', 1))
      expect(day.upNext?.id).toBe('run')
      expect(states(day)).toMatchObject({ 'hyrox-a': 'planned', run: 'next' })
      expect(withLogs('2026-11-04', [], picked('run', '2026-11-03', 1)).upNext).toBeNull()
      expect(withLogs('2026-11-03', [log(1, 'run', '2026-11-03')], picked('run', '2026-11-03', 1)).upNext).toBeNull()
    })
  })

  describe('Race week', () => {
    it('offers the shakeout first, on its Monday', () => {
      expect(on('2027-04-19').upNext?.id).toBe('shakeout')
    })

    it('offers the Station touch once the shakeout is logged', () => {
      expect(withLogs('2027-04-20', [log(24, 'shakeout', '2027-04-19')]).upNext?.id).toBe('station-touch')
    })

    it('waits for Race day once the shakeout and the Station touch are logged', () => {
      const day = withLogs('2027-04-21', [log(24, 'shakeout', '2027-04-19'), log(24, 'station-touch', '2027-04-20')])
      expect(day.upNext).toBeNull()
      expect(day.rest).toMatchObject({ kind: 'waiting', session: { id: 'race' }, date: '2027-04-22' })
    })

    it('pins the race to Race day: it can’t be picked for another day', () => {
      const pickRace = { date: localDate('2027-04-20'), week: 24, sessionId: 'race' }
      const day = withLogs('2027-04-20', [], pickRace)
      expect(day.upNext?.id).toBe('shakeout')
      expect(day.bucket.map((e) => [e.session.id, e.pickable])).toEqual([
        ['shakeout', true],
        ['station-touch', true],
        ['race', false],
      ])
      expect(on('2027-04-22').bucket.find((e) => e.session.id === 'race')?.pickable).toBe(true)
    })

    it('is the race on Race day, whatever was done the day before', () => {
      const day = withLogs('2027-04-22', [log(24, 'station-touch', '2027-04-21')])
      expect(day.upNext?.id).toBe('race')
    })
  })
})

// ---------------------------------------------------------------------------
// Catch-up (ADR-0007). Week 1 runs Mon 9 – Sun 15 Nov, Week 2 Mon 16 – Sun 22 Nov
// (the baseline Compromised run test), Week 3 Mon 23 – Sun 29 Nov. Week 4's Run
// is 4 × 6′; Week 5 is a Deload week.

const week = (n: number) => findWeek(program, n)!
const outcome = (n: number, iso: string, logs: SessionLog[] = []) =>
  weekOutcome(program, week(n), logs, localDate(iso))
const missed = (o: ReturnType<typeof outcome>) => o.skipped.map(({ session, by }) => `${session.id} by ${by}`)
const rows = (day: ReturnType<typeof coach>) => day.bucket.map((e) => `${e.week}/${e.session.id}${e.late ? ' late' : ''}`)
/** Week 1's HYROX A and B done; its Run (Key) and Strength never logged. */
const week1Half = [log(1, 'hyrox-a', '2026-11-09'), log(1, 'hyrox-b', '2026-11-11')]

describe('Catch-up', () => {
  it('serves last Week’s Late sessions first, on a Week 2 Tuesday', () => {
    const day = coach({ program, today: localDate('2026-11-17'), logs: week1Half })
    expect(day.position).toMatchObject({ week: 2 })
    expect(day.upNext).toMatchObject({ id: 'run', headline: '3 × 7′' })
    expect(rows(day)).toEqual([
      '1/run late',
      '1/strength late',
      '2/hyrox-a',
      '2/hyrox-b',
      '2/compromised-run-test',
      '2/strength',
      '2/easy',
    ])
    expect(day.bucket[0]).toMatchObject({ week: 1, state: 'next', late: true, toDo: true, pickable: true })
    expect(day.behind).toEqual({ sessions: 2, week: 1 })
    expect(day.week?.number).toBe(2)
  })

  it('serves the oldest Week’s Late sessions first, and the next Week’s once it is cleared', () => {
    const logs = [
      ...['hyrox-a', 'hyrox-b', 'run'].map((id) => log(1, id, '2026-11-10')),
      ...['hyrox-a', 'compromised-run-test', 'strength'].map((id) => log(2, id, '2026-11-18')),
    ]
    const before = coach({ program, today: localDate('2026-11-25'), logs })
    expect(rows(before).slice(0, 2)).toEqual(['1/strength late', '2/hyrox-b late'])
    expect(before.upNext?.id).toBe('strength')
    expect(before.bucket[0].state).toBe('next')
    expect(before.behind).toEqual({ sessions: 2, week: 1 })

    const week1Cleared = [...logs, log(1, 'strength', '2026-11-23')]
    const after = coach({ program, today: localDate('2026-11-25'), logs: week1Cleared })
    expect(after.upNext?.id).toBe('hyrox-b')
    expect(after.bucket.find((e) => e.state === 'next')).toMatchObject({ week: 2, late: true })
    expect(after.behind).toEqual({ sessions: 1, week: 2 })

    const caughtUp = coach({ program, today: localDate('2026-11-25'), logs: [...week1Cleared, log(2, 'hyrox-b', '2026-11-23')] })
    expect(caughtUp.bucket.every((e) => e.week === 3 && !e.late)).toBe(true)
    expect(caughtUp.behind).toBeNull()
    expect(caughtUp.upNext?.id).toBe('hyrox-a')
  })

  it('lets the Optional session drop away: it is never Late', () => {
    const logs = ['hyrox-a', 'hyrox-b', 'run', 'strength'].map((id) => log(1, id, '2026-11-10'))
    const day = coach({ program, today: localDate('2026-11-17'), logs })
    expect(day.bucket.map((e) => e.week)).toEqual([2, 2, 2, 2, 2])
    expect(day.behind).toBeNull()
    expect(missed(outcome(1, '2026-11-17', logs))).toEqual([])
  })

  it('lets the pointer pass a Session the athlete logged Skipped', () => {
    const logs = [...week1Half, log(1, 'run', '2026-11-13', 'skipped')]
    const day = coach({ program, today: localDate('2026-11-17'), logs })
    expect(rows(day).filter((r) => r.startsWith('1/'))).toEqual(['1/strength late'])
    expect(day.upNext?.id).toBe('strength')
    expect(day.behind).toEqual({ sessions: 1, week: 1 })
    expect(missed(outcome(1, '2026-11-17', logs))).toEqual(['run by athlete'])
  })

  it('lets a Late session Skipped today pass too', () => {
    const logs = [...week1Half, log(1, 'run', '2026-11-17', 'skipped')]
    const day = coach({ program, today: localDate('2026-11-17'), logs })
    expect(day.bucket[0]).toMatchObject({ week: 1, state: 'skipped', toDo: false })
    expect(day.upNext?.id).toBe('strength')
  })

  it('keeps each Late session’s own Week’s Prescription, a full one in a Deload week', () => {
    const logs = [
      ...caughtUpBefore(localDate('2026-11-30')),
      ...['hyrox-a', 'hyrox-b', 'strength'].map((id) => log(4, id, '2026-12-01')),
    ]
    const day = coach({ program, today: localDate('2026-12-08'), logs })
    expect(day.week?.deload).toBe(true)
    expect(day.upNext).toMatchObject({ id: 'run', headline: '4 × 6′' })
    expect(day.bucket[0]).toMatchObject({ week: 4, late: true, session: { headline: '4 × 6′' } })
  })

  it('counts a Late session logged today for its own Week, Done in the Bucket until tomorrow', () => {
    const logs = [...week1Half, log(1, 'run', '2026-11-17'), log(1, 'strength', '2026-11-17')]
    const day = coach({ program, today: localDate('2026-11-17'), logs })
    expect(rows(day).slice(0, 2)).toEqual(['1/run late', '1/strength late'])
    expect(day.bucket.slice(0, 2).map((e) => e.state)).toEqual(['done', 'done'])
    expect(day.behind).toBeNull()
    expect(outcome(1, '2026-11-17', logs)).toEqual({ skipped: [] })
    expect(coach({ program, today: localDate('2026-11-18'), logs }).bucket.every((e) => e.week === 2)).toBe(true)
  })

  it('still lets a current-Week Session be picked to do today instead', () => {
    const today = localDate('2026-11-17')
    const day = coach({ program, today, logs: week1Half, picked: { date: today, week: 2, sessionId: 'strength' } })
    expect(day.upNext?.id).toBe('strength')
    expect(day.bucket.find((e) => e.state === 'next')).toMatchObject({ week: 2, late: false })
    expect(day.bucket[0]).toMatchObject({ week: 1, state: 'planned', late: true })
    expect(day.behind).toEqual({ sessions: 2, week: 1 })
  })

  it('carries nothing over: an undone Key session is Late like the rest, and never a miss', () => {
    for (const iso of ['2026-11-17', '2026-11-19', '2026-12-04']) {
      const day = coach({ program, today: localDate(iso), logs: week1Half })
      expect(day.bucket.filter((e) => e.week === 1).map((e) => e.session.id)).toEqual(['run', 'strength'])
      expect(day.bucket[0]).not.toHaveProperty('carriedUntil')
      expect(outcome(1, iso, week1Half)).toEqual({ skipped: [] })
    }
  })

  it('counts toward the spacing rules on the day it is done', () => {
    // Week 2's HYROX A and B done, Week 1's late Strength on Wednesday: Thursday
    // rests, with Week 2's test and Strength still fitting into Friday to Sunday.
    const logs = [
      ...['hyrox-a', 'hyrox-b', 'run'].map((id) => log(1, id, '2026-11-10')),
      log(2, 'hyrox-a', '2026-11-16'),
      log(2, 'hyrox-b', '2026-11-17'),
      log(1, 'strength', '2026-11-18'),
    ]
    const day = coach({ program, today: localDate('2026-11-19'), logs })
    expect(day.upNext).toBeNull()
    expect(day.rest).toMatchObject({ kind: 'hard-yesterday', anyway: { week: 2, session: { id: 'strength' } } })
  })
})

// Race specific starts Monday 22 February 2027 (Week 16). Week 14 (a test Week)
// runs Mon 8 – Sun 14 Feb, Week 15 (a Deload week) Mon 15 – Sun 21 Feb.

describe('Catch-up ending as Race specific starts', () => {
  /** Weeks 1–13 cleared; Week 14's test and Strength and Week 15's Strength never logged. */
  const behind = [
    ...caughtUpBefore(localDate('2027-02-08')),
    log(14, 'hyrox-a', '2027-02-08'),
    log(14, 'hyrox-b', '2027-02-10'),
    ...['hyrox-a', 'hyrox-b', 'run'].map((id) => log(15, id, '2027-02-16')),
  ]
  const lateIds = ['compromised-run-test by coach', 'strength by coach']

  it('starts Race specific on Monday 22 February, Week 16', () => {
    expect(on('2027-02-22').position).toMatchObject({ week: 16, phase: 'race-specific', startDate: '2027-02-22' })
    expect(on('2027-02-21').position).toMatchObject({ week: 15, phase: 'build' })
  })

  it('still serves the Late sessions the Sunday before, Week 15’s Strength still in its own Week', () => {
    const day = coach({ program, today: localDate('2027-02-21'), logs: behind })
    expect(rows(day).filter((r) => r.endsWith('late'))).toEqual(['14/compromised-run-test late', '14/strength late'])
    expect(day.upNext?.id).toBe('compromised-run-test')
    expect(day.behind).toEqual({ sessions: 2, week: 14 })
    expect(day.dropped).toBeNull()
    expect(missed(outcome(14, '2027-02-21', behind))).toEqual([])
  })

  it('drops them as Coach-Skipped on its Monday: they never come back as Up next', () => {
    for (const iso of ['2027-02-22', '2027-02-24', '2027-03-05']) {
      const day = coach({ program, today: localDate(iso), logs: behind })
      expect(day.bucket.some((e) => e.late)).toBe(false)
      expect(day.behind).toBeNull()
      expect(missed(outcome(14, iso, behind))).toEqual(lateIds)
      expect(missed(outcome(15, iso, behind))).toEqual(['strength by coach'])
    }
    const monday = coach({ program, today: localDate('2027-02-22'), logs: behind })
    expect(monday.upNext).toMatchObject({ id: 'race-simulation' })
    expect(rows(monday)[0]).toBe('16/race-simulation')
  })

  it('says how many were dropped, and from which Weeks, until it is dismissed', () => {
    const notice = { id: 'dropped-race-specific', sessions: 3, firstWeek: 14, lastWeek: 15 }
    expect(coach({ program, today: localDate('2027-02-22'), logs: behind }).dropped).toEqual(notice)
    // The first time Today opens on or after that Monday, whenever that is.
    expect(coach({ program, today: localDate('2027-03-02'), logs: behind }).dropped).toEqual(notice)

    const dismissed: SuggestionDecision = {
      id: 'dropped-race-specific',
      decision: 'kept',
      date: localDate('2027-02-22'),
      updatedAt: '2027-02-22T12:00:00.000Z',
    }
    expect(coach({ program, today: localDate('2027-02-23'), logs: behind, decisions: [dismissed] }).dropped).toBeNull()
  })

  it('says nothing when nothing was late', () => {
    const day = coach({ program, today: localDate('2027-02-22'), logs: caughtUpBefore(localDate('2027-02-22')) })
    expect(day.dropped).toBeNull()
  })

  it('counts only Sessions the Coach dropped, not the athlete’s own Skips', () => {
    const logs = [...behind, log(14, 'compromised-run-test', '2027-02-12', 'skipped'), log(14, 'strength', '2027-02-20')]
    expect(coach({ program, today: localDate('2027-02-22'), logs }).dropped).toMatchObject({
      sessions: 1,
      firstWeek: 15,
      lastWeek: 15,
    })
  })

  it('from then on misses a Week’s undone required Sessions on its Sunday, as before Catch-up', () => {
    const logs = [
      ...caughtUpBefore(localDate('2027-02-22')),
      log(16, 'race-simulation', '2027-02-22'),
      log(16, 'hyrox-b', '2027-02-24'),
    ]
    expect(missed(outcome(16, '2027-02-28', logs))).toEqual([])
    expect(missed(outcome(16, '2027-03-01', logs))).toEqual(['run by coach', 'strength by coach'])
    const day = coach({ program, today: localDate('2027-03-01'), logs })
    expect(day.bucket.every((e) => e.week === 17 && !e.late)).toBe(true)
    expect(day.behind).toBeNull()
    expect(day.dropped).toBeNull()
  })
})

describe('Sessions not done by Sunday', () => {
  it('leave the Optional session alone: missing it is not a miss', () => {
    expect(missed(outcome(3, '2026-12-04'))).not.toContain('easy by coach')
    expect(missed(outcome(3, '2026-12-04', [log(3, 'easy', '2026-11-24', 'skipped')]))).not.toContain('easy by athlete')
  })

  it('count a Skipped log once the Week is over, and never Done, Partial or Swapped', () => {
    const logs = [
      log(3, 'hyrox-a', '2026-11-23', 'skipped'),
      log(3, 'hyrox-b', '2026-11-24', 'partial'),
      log(3, 'run', '2026-11-25', 'swapped'),
      log(3, 'strength', '2026-11-26', 'done'),
    ]
    // Until Sunday a Skipped Session can still be done: not a miss yet.
    expect(missed(outcome(3, '2026-11-25', logs))).toEqual([])
    expect(missed(outcome(3, localDateIn(new Date('2026-11-30T04:59:59Z')), logs))).toEqual([])
    expect(missed(outcome(3, localDateIn(new Date('2026-11-30T05:00:00Z')), logs))).toEqual(['hyrox-a by athlete'])
  })

  it('are Late, not missed: the Coach Skips nothing', () => {
    expect(missed(outcome(3, '2026-12-04'))).toEqual([])
    expect(missed(outcome(5, '2026-12-28'))).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// The lighter re-entry Week, after a gap in training (ADR-0007). Week 7 (Mon
// 21 – Sun 27 Dec) done Monday to Thursday; Week 8 (Mon 28 Dec – Sun 3 Jan):
// HYROX A, HYROX B, the Run (4 × (1 km + 20 wall balls), Key), Strength. Week
// 10 is a Deload week.

const CLEARED = caughtUpBefore(localDate('2026-12-21'))
const WEEK_7 = ['hyrox-a', 'hyrox-b', 'run', 'strength'].map((id, i) => log(7, id, `2026-12-2${1 + i}`))

function decided(decision: Decision, id = 're-entry-w8', date = '2026-12-31'): SuggestionDecision {
  return { id, decision, date: localDate(date), updatedAt: `${date}T12:00:00.000Z` }
}

const onDay = (iso: string, logs: SessionLog[], decisions: SuggestionDecision[] = []) =>
  coach({ program, today: localDate(iso), logs: [...CLEARED, ...logs], decisions })
/** Back after Week 7, its last Session on Thursday 24 December. */
const back = (iso: string, logs: SessionLog[] = [], decisions: SuggestionDecision[] = []) =>
  onDay(iso, [...WEEK_7, ...logs], decisions)
const ids = (day: ReturnType<typeof coach>) => day.suggestions.map((s) => s.id)
const firstStation = (session: { blocks: { main?: boolean; exercises: { prescription: unknown }[] }[] }) =>
  session.blocks.find((b) => b.main)!.exercises.map((e) => e.prescription)

describe('the re-entry Suggestion', () => {
  it('comes after 7 days with no Session, not 6, as structured facts', () => {
    expect(back('2026-12-30').suggestions).toEqual([])
    expect(back('2026-12-31').suggestions).toEqual([
      {
        id: 're-entry-w8',
        kind: 're-entry',
        week: 8,
        sessionId: null,
        date: '2026-12-31',
        from: { volumePercent: 100 },
        to: { volumePercent: 67 },
        trigger: { lastSession: '2026-12-24', days: 7 },
        decision: 'open',
        decidedOn: null,
      },
    ])
  })

  it('counts only Done or Partial as training: Skipped or Swapped leaves the gap open', () => {
    const notTrained = [log(8, 'hyrox-a', '2026-12-28', 'skipped'), log(8, 'hyrox-b', '2026-12-29', 'swapped')]
    expect(ids(back('2026-12-31', notTrained))).toEqual(['re-entry-w8'])
    expect(back('2026-12-31', [log(8, 'hyrox-a', '2026-12-28', 'partial')]).suggestions).toEqual([])
  })

  it('stays for the rest of the Week once the athlete is back, then goes', () => {
    const returned = [log(8, 'hyrox-a', '2026-12-31')]
    for (const iso of ['2026-12-31', '2027-01-02']) {
      expect(back(iso, returned).suggestions).toEqual([
        expect.objectContaining({ id: 're-entry-w8', date: '2026-12-31', trigger: { lastSession: '2026-12-24', days: 7 } }),
      ])
    }
    const rest = ['hyrox-b', 'run', 'strength'].map((id, i) => log(8, id, `2027-01-0${1 + i}`))
    expect(ids(back('2027-01-04', [...returned, ...rest]))).not.toContain('re-entry-w8')
  })

  it('no longer comes from Skips: two Skipped Sessions while training goes on', () => {
    const skipped = [
      log(7, 'hyrox-a', '2026-12-21'),
      log(7, 'hyrox-b', '2026-12-22'),
      log(7, 'run', '2026-12-23', 'skipped'),
      log(7, 'strength', '2026-12-24', 'skipped'),
      log(8, 'hyrox-a', '2026-12-28'),
    ]
    expect(onDay('2026-12-29', skipped).suggestions).toEqual([])
  })

  it('lightens the rest of the Late Week Up next comes from when the gap ends in Catch-up', () => {
    const logs = [log(7, 'hyrox-a', '2026-12-21'), log(7, 'hyrox-b', '2026-12-22')]
    const day = onDay('2026-12-30', logs)
    expect(day.behind).toEqual({ sessions: 2, week: 7 })
    expect(day.suggestions).toEqual([
      expect.objectContaining({ id: 're-entry-w7', week: 7, date: '2026-12-30', trigger: { lastSession: '2026-12-22', days: 8 } }),
    ])

    const lighter = onDay('2026-12-30', logs, [decided('accepted', 're-entry-w7', '2026-12-30')])
    expect(lighter.upNext).toMatchObject({ id: 'run', headline: '2 × 8′', minutes: 30 })
    expect(lighter.bucket.filter((e) => e.week === 8).map((e) => e.session.minutes)).toEqual([45, 45, 45, 45, 40])
    // What was done before the gap stays as it was.
    const week7 = prescribedWeek(program, 7, [...CLEARED, ...logs], [decided('accepted', 're-entry-w7', '2026-12-30')], DEFAULT_EQUIPMENT, {
      reports: [],
      today: localDate('2026-12-30'),
    })!
    expect(week7.sessions.map((s) => s.minutes)).toEqual([45, 45, 30, 30, 23])
  })

  it('never lightens a Deload week, nor the Taper', () => {
    // Week 4 done Monday to Thursday, back in Week 5, a Deload.
    const week4Days = ['2026-11-30', '2026-12-01', '2026-12-02', '2026-12-03']
    const week4 = ['hyrox-a', 'hyrox-b', 'run', 'strength'].map((id, i) => log(4, id, week4Days[i]))
    expect(coach({ program, today: localDate('2026-12-11'), logs: [...caughtUpBefore(localDate('2026-11-30')), ...week4] }).suggestions).toEqual([])
    // Week 21 done, back in Week 22.
    const week21Days = ['2027-03-29', '2027-03-30', '2027-03-31', '2027-04-01']
    const week21 = ['race-simulation', 'hyrox-b', 'run', 'strength'].map((id, i) => log(21, id, week21Days[i]))
    const taper = coach({ program, today: localDate('2027-04-09'), logs: [...caughtUpBefore(localDate('2027-03-29')), ...week21] })
    expect(taper.position).toMatchObject({ week: 22, phase: 'taper' })
    expect(taper.suggestions.filter((s) => s.kind === 're-entry')).toEqual([])
  })

  it('changes nothing until it is Accepted', () => {
    const day = back('2026-12-31')
    expect(day.upNext).toMatchObject({ id: 'hyrox-a', headline: '4 rounds', minutes: 45 })
    expect(day.week).toEqual(equipWeek(findWeek(program, 8)!, DEFAULT_EQUIPMENT))
  })

  it('lightens every Prescription of the Week by a third once Accepted', () => {
    const day = back('2026-12-31', [], [decided('accepted')])
    expect(day.suggestions[0]).toMatchObject({ decision: 'accepted', decidedOn: '2026-12-31' })
    expect(day.upNext).toMatchObject({ id: 'hyrox-a', minutes: 30 })
    expect(day.bucket.map((e) => e.session.minutes)).toEqual([30, 30, 30, 30, 27])
    expect(firstStation(day.upNext!)).toEqual([
      { kind: 'station', station: 'sled-push', meters: 15, reps: undefined },
      { kind: 'run', meters: 400, minutes: undefined },
    ])
  })

  it('keeps the Program as written when Kept, and again after Undo', () => {
    for (const d of [decided('kept'), decided('open')]) {
      const day = back('2026-12-31', [], [d])
      expect(day.suggestions[0].decision).toBe(d.decision)
      expect(day.upNext).toMatchObject({ headline: '4 rounds', minutes: 45 })
    }
  })

  it('shows the lighter Week on other screens too', () => {
    const logs = [...CLEARED, ...WEEK_7]
    const today = { reports: [], today: localDate('2026-12-31') }
    expect(prescribedWeek(program, 8, logs, [decided('accepted')], DEFAULT_EQUIPMENT, today)?.sessions[0].minutes).toBe(30)
    expect(prescribedWeek(program, 8, logs, [decided('kept')], DEFAULT_EQUIPMENT, today)?.sessions[0].minutes).toBe(45)
    // Once back, the logs alone place the gap.
    const returned = [...logs, log(8, 'hyrox-b', '2026-12-31')]
    expect(prescribedWeek(program, 8, returned, [decided('accepted')])?.sessions[0].minutes).toBe(30)
    expect(prescribedWeek(program, 7, returned, [decided('accepted')])).toEqual(equipWeek(findWeek(program, 7)!, DEFAULT_EQUIPMENT))
  })
})

// ---------------------------------------------------------------------------
// The pain rules. Week 3 (Mon 23 – Sun 29 Nov): HYROX A (Key), HYROX B with
// burpee broad jumps in round 2, the Run 3 × 8′ at Threshold, Strength, Easy run.

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
  return coach({ program, today: localDate(iso), logs: [...caughtUpBefore(localDate(iso)), ...logs], painReports, decisions })
}

/** Only the pain Suggestions: Week 2's Sessions other than the Key one went undone, so re-entry is there too. */
const painOf = (day: ReturnType<typeof coach>) => day.suggestions.filter((s) => s.kind === 'pain')

const mainIntervals = (session: { blocks: { main?: boolean; exercises: { prescription: unknown }[] }[] }) =>
  session.blocks.find((b) => b.main)!.exercises[0].prescription

const runOf = (day: ReturnType<typeof coach>) => day.bucket.find((e) => e.session.id === 'run')!.session
const roundStations = (session: Session) =>
  session.blocks
    .filter((b) => b.main)
    .map((b) => b.exercises.flatMap(({ prescription: rx }) => (rx.kind === 'station' ? [`${rx.station} ${rx.meters ?? ''}`.trim()] : [])))

describe('the pain rules', () => {
  it('stay out of it with no Pain report, or with pain under 3 and not rising', () => {
    expect(painOf(withPain('2026-11-25', []))).toEqual([])
    expect(withPain('2026-11-25', []).pain).toBeNull()
    for (const score of [0, 1, 2]) {
      const day = withPain('2026-11-25', [pain('2026-11-25', score)])
      expect(painOf(day)).toEqual([])
      expect(day.pain).toMatchObject({ report: { score }, level: null })
    }
  })

  it('suggest easing at pain 3', () => {
    const report = pain('2026-11-25', 3, { area: 'shin' })
    const day = withPain('2026-11-25', [report])
    expect(painOf(day)).toEqual([
      {
        id: `pain-${report.id}`,
        kind: 'pain',
        week: 3,
        sessionId: null,
        date: '2026-11-25',
        level: 'ease',
        trigger: { score: 3, area: 'shin', risingFrom: null },
        decision: 'open',
        decidedOn: null,
      },
    ])
    expect(day.pain).toMatchObject({ level: 'ease' })
  })

  it('change nothing until the Suggestion is Accepted, nor once it is Kept', () => {
    const report = pain('2026-11-25', 4)
    for (const decisions of [[], [painDecision(report, 'kept')], [painDecision(report, 'open')]]) {
      const day = withPain('2026-11-25', [report], decisions)
      expect(day.upNext).toBe(findWeek(program, 3)!.sessions[0])
      expect(runOf(day)).toBe(findWeek(program, 3)!.sessions[2])
    }
  })

  it('swap burpee broad jumps and sled push for an erg and cut interval reps by about 30% once Accepted', () => {
    const report = pain('2026-11-25', 4)
    const day = withPain('2026-11-25', [report], [painDecision(report, 'accepted')])
    const hyroxB = day.bucket.find((e) => e.session.id === 'hyrox-b')!.session
    expect(roundStations(hyroxB)).toEqual([['skierg 250'], ['skierg 250'], ['row 250'], ['wall-balls']])
    expect(roundStations(day.upNext!)).toEqual([['row 500'], ['sled-pull 25'], ['farmers-carry 100'], ['sandbag-lunges 25']])
    const run = runOf(day)
    expect(run).toMatchObject({ headline: '2 × 8′', minutes: 36 })
    expect(mainIntervals(run)).toMatchObject({ kind: 'intervals', reps: 2, workSeconds: 480 })
    // Strength, with nothing to swap or cut, stays as written.
    expect(day.bucket.find((e) => e.session.id === 'strength')!.session).toEqual(prescribedWeek(program, 3, [], [])!.sessions[3])
  })

  it('make every Session easy low-impact work or rest at pain 5 or more', () => {
    for (const score of [5, 8, 10]) {
      const report = pain('2026-11-25', score, { area: 'knee' })
      const day = withPain('2026-11-25', [report], [painDecision(report, 'accepted')])
      expect(painOf(day)[0]).toMatchObject({ level: 'low-impact', trigger: { score, area: 'knee' } })
      expect(day.bucket.map((e) => e.session.headline)).toEqual(Array(5).fill('easy bike 30′ or rest'))
      expect(day.bucket.map((e) => e.session.type)).toEqual(['hyrox', 'hyrox', 'run', 'strength', 'easy'])
      expect(day.upNext!.blocks).toHaveLength(1)
      expect(mainIntervals(day.upNext!)).toEqual({ kind: 'note', minutes: 30 })
      // Nothing left to run, lift or push: Log after, not Start session.
      expect(day.bucket.map((e) => isLive(e.session))).toEqual([false, false, false, false, false])
    }
  })

  it('apply to a Session of another Week done today, early or late, and only then', () => {
    const report = pain('2026-11-25', 4)
    const decisions = [painDecision(report, 'accepted')]
    const reports = { reports: [report], today: localDate('2026-11-25') }
    const asWritten = (week: number) => prescribedWeek(program, week, [], decisions)!
    const withPainToday = (week: number, doneToday: boolean) =>
      prescribedWeek(program, week, [], decisions, undefined, { ...reports, doneToday })!
    expect(withPainToday(4, false)).toEqual(asWritten(4))
    expect([1, 4].map((w) => asWritten(w).sessions[2].headline)).toEqual(['3 × 7′', '4 × 6′'])
    expect([1, 4].map((w) => withPainToday(w, true).sessions[2].headline)).toEqual(['2 × 7′', '3 × 6′'])
  })

  it('count rising pain, higher than the report before, as pain 3', () => {
    const before = pain('2026-11-24', 1)
    const rising = pain('2026-11-25', 2)
    const day = withPain('2026-11-25', [before, rising])
    expect(painOf(day)[0]).toMatchObject({ id: `pain-${rising.id}`, level: 'ease', trigger: { score: 2, risingFrom: 1 } })

    expect(painOf(withPain('2026-11-25', [pain('2026-11-24', 2), pain('2026-11-25', 2)]))).toEqual([])
    expect(painOf(withPain('2026-11-25', [pain('2026-11-24', 2), pain('2026-11-25', 1)]))).toEqual([])
    // Rising from no pain at all is still rising.
    expect(painOf(withPain('2026-11-25', [pain('2026-11-24', 0), pain('2026-11-25', 1)]))[0]).toMatchObject({
      level: 'ease',
      trigger: { risingFrom: 0 },
    })
  })

  it('compare reports given the same day in the order they were given', () => {
    const morning = pain('2026-11-25', 1, { at: '11:00' })
    const evening = pain('2026-11-25', 2, { at: '22:00' })
    expect(painOf(withPain('2026-11-25', [evening, morning]))[0]).toMatchObject({ trigger: { risingFrom: 1 } })
  })

  it('end when the next report says No', () => {
    const report = pain('2026-11-24', 6)
    const day = withPain('2026-11-25', [report, pain('2026-11-25', 0)], [painDecision(report, 'accepted')])
    expect(painOf(day)).toEqual([])
    expect(day.upNext).toBe(findWeek(program, 3)!.sessions[0])
  })

  it('stand until the next report, Accepted or not', () => {
    const report = pain('2026-11-23', 4)
    const day = withPain('2026-11-26', [report], [painDecision(report, 'accepted')])
    expect(painOf(day)[0]).toMatchObject({ date: '2026-11-23', decision: 'accepted', decidedOn: '2026-11-23' })
    expect(runOf(day).headline).toBe('2 × 8′')
  })

  it('ignore a report from a later day', () => {
    expect(painOf(withPain('2026-11-25', [pain('2026-11-26', 7)]))).toEqual([])
  })

  describe('a next-morning report after a Session', () => {
    // HYROX A done on Tuesday after saying 2 at Start; Wednesday morning, Something hurts.
    const atStart = pain('2026-11-24', 2, { session: [3, 'hyrox-a'], at: '22:00' })
    const hyroxDone = log(3, 'hyrox-a', '2026-11-24')

    it('applies the rules from that morning when it reaches 3', () => {
      const morning = pain('2026-11-25', 3)
      const day = withPain('2026-11-25', [atStart, morning], [painDecision(morning, 'accepted')], [hyroxDone])
      expect(painOf(day)[0]).toMatchObject({ date: '2026-11-25', level: 'ease', trigger: { score: 3, risingFrom: 2 } })
      expect(runOf(day).headline).toBe('2 × 8′')
    })

    it('counts as rising when it is higher than the report at Start, even under 3', () => {
      const lower = pain('2026-11-24', 1, { session: [3, 'hyrox-a'], at: '22:00' })
      const morning = pain('2026-11-25', 2)
      const day = withPain('2026-11-25', [lower, morning], [], [hyroxDone])
      expect(painOf(day)[0]).toMatchObject({ level: 'ease', trigger: { score: 2, risingFrom: 1 } })
    })

    it('leaves the Session already logged as it was written', () => {
      const morning = pain('2026-11-25', 6)
      const day = withPain('2026-11-25', [atStart, morning], [painDecision(morning, 'accepted')], [hyroxDone])
      expect(day.bucket.find((e) => e.session.id === 'hyrox-a')!.session).toBe(findWeek(program, 3)!.sessions[0])
      expect(day.bucket.find((e) => e.session.id === 'strength')!.session.headline).toBe('easy bike 30′ or rest')
    })
  })

  it('leave the race alone', () => {
    const report = pain('2027-04-22', 7)
    const day = withPain('2027-04-22', [report], [painDecision(report, 'accepted')])
    expect(day.upNext).toMatchObject({ id: 'race', headline: findWeek(program, 24)!.sessions.find((s) => s.id === 'race')!.headline })
  })

  it('apply to a Late session still open', () => {
    // Week 3's Run never logged: Late on Monday of Week 4.
    const logs = ['hyrox-a', 'hyrox-b', 'strength'].map((id) => log(3, id, '2026-11-24'))
    const report = pain('2026-11-30', 4)
    const day = coach({
      program,
      today: localDate('2026-11-30'),
      logs: [...caughtUpBefore(localDate('2026-11-23')), ...logs],
      painReports: [report],
      decisions: [painDecision(report, 'accepted')],
    })
    expect(day.bucket[0]).toMatchObject({ week: 3, late: true, session: { id: 'run', headline: '2 × 8′' } })
  })

  it('show on other screens for the Week holding today only', () => {
    const report = pain('2026-11-25', 4)
    const decisions = [painDecision(report, 'accepted')]
    const today = localDate('2026-11-25')
    expect(prescribedWeek(program, 3, [], decisions, undefined, { reports: [report], today })?.sessions[2].headline).toBe('2 × 8′')
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

/** A normal week of nights before Wednesday 25 November: HRV averaging 52. */
const baseline = ['2026-11-18', '2026-11-19', '2026-11-20', '2026-11-21', '2026-11-22', '2026-11-23', '2026-11-24'].map(
  (iso, i) => night(iso, 450, [50, 54, 52, 51, 53, 52, 52][i]),
)

function withNights(
  iso: string,
  recoveryNights: RecoveryNight[],
  decisions: SuggestionDecision[] = [],
  logs: SessionLog[] = [],
  picked: CoachInput['picked'] = null,
) {
  return coach({ program, today: localDate(iso), logs: [...caughtUpBefore(localDate(iso)), ...logs], decisions, recoveryNights, picked })
}

const recoveryOf = (day: ReturnType<typeof coach>) => day.suggestions.filter((s) => s.kind === 'recovery')

const recoveryDecision = (decision: Decision): SuggestionDecision => ({
  id: 'recovery-2026-11-25',
  decision,
  date: localDate('2026-11-25'),
  updatedAt: '2026-11-25T13:00:00.000Z',
})

/** Both HYROX sessions done Monday: on Wednesday the Run is Up next. */
const hyroxMonday = [log(3, 'hyrox-a', '2026-11-23'), log(3, 'hyrox-b', '2026-11-23')]

describe('the recovery rules', () => {
  const asWritten = findWeek(program, 3)!.sessions[0]

  it('change nothing without a night for today', () => {
    for (const nights of [[], baseline, [night('2026-11-24', 300, 30)]]) {
      const day = withNights('2026-11-25', nights)
      expect(day.upNext).toBe(asWritten)
      expect(day.recovery).toBeNull()
      expect(day.recoveryChange).toBeNull()
      expect(recoveryOf(day)).toEqual([])
    }
  })

  it('change nothing after 6 hours of sleep or more, whatever HRV does', () => {
    for (const sleep of [360, 480]) {
      const day = withNights('2026-11-25', [...baseline, night('2026-11-25', sleep, 30)])
      expect(day.upNext).toBe(asWritten)
      expect(day.recovery).toMatchObject({ shortSleep: false, easyDay: false, hrvMean: 52 })
      expect(recoveryOf(day)).toEqual([])
    }
  })

  it('take one rep off and cap RPE at 7 for the Run after under 6 hours', () => {
    const written = findWeek(program, 3)!.sessions[2]
    const day = withNights('2026-11-25', [...baseline, night('2026-11-25', 341, 50)], [], hyroxMonday)
    expect(day.recoveryChange).toBe('short-sleep')
    expect(day.recoveryCut).toBe('rep')
    expect(day.upNext).toMatchObject({ id: 'run', headline: '2 × 8′' })
    expect(day.upNext!.minutes).toBeLessThan(written.minutes)
    expect(day.upNext!.note).toMatch(/^Short sleep \(5 h 41\): one rep fewer, nothing past RPE 7\./)
    expect(mainIntervals(day.upNext!)).toMatchObject({ kind: 'intervals', reps: 2, workSeconds: 480 })
    const efforts = day.upNext!.blocks
      .filter((b) => b.main)
      .flatMap((b) => b.exercises)
      .flatMap((e) => ('effort' in e.prescription && e.prescription.effort?.rpe ? [e.prescription.effort.rpe] : []))
    for (const [, high] of efforts) expect(high).toBeLessThanOrEqual(7)
    // Up next only: the rest of the Bucket stays as written.
    expect(day.bucket.find((e) => e.session.id === 'easy')!.session).toBe(findWeek(program, 3)!.sessions[4])
    expect(day.bucket.find((e) => e.state === 'next')!.session).toBe(day.upNext)
    // HRV normal: no Suggestion.
    expect(recoveryOf(day)).toEqual([])
  })

  it('take a rep off every main lift and cap its sets at RPE 7 on a Strength day', () => {
    const picked = { date: localDate('2026-11-25'), week: 3, sessionId: 'strength' }
    const day = withNights('2026-11-25', [...baseline, night('2026-11-25', 300)], [], [], picked)
    expect(day.upNext!.type).toBe('strength')
    expect(day.recoveryCut).toBe('rep')
    expect(day.upNext!.note).toMatch(/^Short sleep \(5 h 00\): one rep fewer, nothing past RPE 7\./)
    const written = findWeek(program, 3)!.sessions.find((s) => s.id === day.upNext!.id)!
    const sets = (s: typeof written) =>
      s.blocks.filter((b) => b.main).flatMap((b) => b.exercises.map((e) => e.prescription)).filter((rx) => rx.kind === 'sets')
    const before = sets(written)
    const after = sets(day.upNext!)
    expect(after.length).toBeGreaterThan(0)
    after.forEach((rx, i) => {
      const was = before[i]
      if (rx.kind !== 'sets' || was.kind !== 'sets') throw new Error('not sets')
      expect(rx.sets).toBe(was.sets)
      if (typeof rx.reps === 'number' && typeof was.reps === 'number' && !was.meters) expect(rx.reps).toBe(Math.max(1, was.reps - 1))
      expect(rx.rpeCap).toBeLessThanOrEqual(7)
      if (rx.rpe) expect(rx.rpe[1]).toBeLessThanOrEqual(7)
    })
  })

  it('take the last round off a HYROX session, and say so on its Suggestion', () => {
    const day = withNights('2026-11-25', [...baseline, night('2026-11-25', 320, 40)])
    expect(day.upNext!.id).toBe('hyrox-a')
    expect(day.recoveryCut).toBe('round')
    expect(day.upNext!.blocks.filter((b) => b.main).map((b) => b.name)).toEqual(['Round 1', 'Round 2', 'Round 3'])
    expect(recoveryOf(day)[0]).toMatchObject({ sessionId: 'hyrox-a', cut: 'round' })
  })

  it('leave an Easy run alone', () => {
    const easyOnly = findWeek(program, 3)!.sessions
      .filter((s) => s.type !== 'easy')
      .map((s) => log(3, s.id, '2026-11-23'))
    const day = withNights('2026-11-25', [...baseline, night('2026-11-25', 300, 30)], [], easyOnly)
    expect(day.upNext!.type).toBe('easy')
    expect(day.upNext).toBe(findWeek(program, 3)!.sessions.find((s) => s.type === 'easy'))
    expect(day.recoveryChange).toBeNull()
    expect(recoveryOf(day)).toEqual([])
  })

  it('suggest an easy day when HRV is at least 15% under its 7-night mean as well', () => {
    // 44 is 15.4% under 52.
    const day = withNights('2026-11-25', [...baseline, night('2026-11-25', 341, 44)])
    expect(recoveryOf(day)).toEqual([
      {
        id: 'recovery-2026-11-25',
        kind: 'recovery',
        week: 3,
        sessionId: 'hyrox-a',
        date: '2026-11-25',
        cut: 'round',
        trigger: { sleepMinutes: 341, hrvMs: 44, hrvMean: 52 },
        decision: 'open',
        decidedOn: null,
      },
    ])
    // Until it's Accepted, the short-sleep rule stands.
    expect(day.recoveryChange).toBe('short-sleep')
    expect(day.upNext!.blocks.filter((b) => b.main)).toHaveLength(3)
  })

  it('raise no Suggestion for HRV only 14% under, or for low HRV after a full night', () => {
    expect(recoveryOf(withNights('2026-11-25', [...baseline, night('2026-11-25', 341, 45)]))).toEqual([])
    expect(recoveryOf(withNights('2026-11-25', [...baseline, night('2026-11-25', 420, 30)]))).toEqual([])
  })

  it('raise no Suggestion without HRV, or with fewer than 3 nights to average', () => {
    expect(recoveryOf(withNights('2026-11-25', [...baseline, night('2026-11-25', 300, null)]))).toEqual([])
    const day = withNights('2026-11-25', [...baseline.slice(-2), night('2026-11-25', 300, 20)])
    expect(day.recovery).toMatchObject({ hrvMean: null, easyDay: false })
    expect(recoveryOf(day)).toEqual([])
    expect(day.recoveryChange).toBe('short-sleep')
  })

  it('only average the 7 nights before the morning', () => {
    const old = night('2026-11-17', 450, 200)
    expect(withNights('2026-11-25', [old, ...baseline, night('2026-11-25', 341, 44)]).recovery?.hrvMean).toBe(52)
  })

  it('make the Hard session an easy 30′ once the Suggestion is Accepted, and only then', () => {
    const nights = [...baseline, night('2026-11-25', 341, 44)]
    const accepted = withNights('2026-11-25', nights, [recoveryDecision('accepted')])
    expect(accepted.recoveryChange).toBe('easy-day')
    expect(accepted.upNext).toMatchObject({ id: 'hyrox-a', type: 'hyrox', headline: 'easy 30′ or rest', minutes: 30 })
    expect(recoveryOf(accepted)[0]).toMatchObject({ decision: 'accepted', decidedOn: '2026-11-25' })

    const kept = withNights('2026-11-25', nights, [recoveryDecision('kept')])
    expect(kept.recoveryChange).toBe('short-sleep')
    expect(kept.upNext!.blocks.filter((b) => b.main)).toHaveLength(3)
  })

  it('apply to today only: tomorrow without a night is as written', () => {
    const day = withNights('2026-11-26', [...baseline, night('2026-11-25', 300, 30)], [recoveryDecision('accepted')])
    expect(day.recovery).toBeNull()
    expect(day.recoveryChange).toBeNull()
    expect(recoveryOf(day)).toEqual([])
  })

  it('leave Race day as it is', () => {
    const raceDay = localDate('2027-04-22')
    const day = withNights(raceDay, [
      night('2027-04-19', 450, 52),
      night('2027-04-20', 450, 52),
      night('2027-04-21', 450, 52),
      night(raceDay, 240, 30),
    ])
    expect(day.upNext?.date).toBe(raceDay)
    expect(day.recoveryChange).toBeNull()
    expect(recoveryOf(day)).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// Three Readiness flags in a Week: the rest of it a third lighter. Week 3 (Mon
// 23 – Sun 29 Nov); Week 5 is a Deload week, Week 22 the Taper.

const lighterOf = (day: ReturnType<typeof coach>) => day.suggestions.filter((s) => s.kind === 'lighter-week')

function readiness(
  iso: string,
  { reports = [], nights = [], decisions = [], logs = [] }: { reports?: PainReport[]; nights?: RecoveryNight[]; decisions?: SuggestionDecision[]; logs?: SessionLog[] },
) {
  return coach({
    program,
    today: localDate(iso),
    logs: [...caughtUpBefore(localDate(iso)), ...logs],
    painReports: reports,
    recoveryNights: nights,
    decisions,
  })
}

const lighterDecision = (decision: Decision, week = 3, date = '2026-11-25'): SuggestionDecision => ({
  id: `lighter-week-w${week}`,
  decision,
  date: localDate(date),
  updatedAt: `${date}T13:00:00.000Z`,
})

describe('the lighter-Week Suggestion from Readiness', () => {
  // Monday pain 3, Tuesday a short night, Wednesday pain 4.
  const monday = pain('2026-11-23', 3)
  const tuesday = night('2026-11-24', 320)
  const wednesday = pain('2026-11-25', 4)
  const flags = { reports: [monday, wednesday], nights: [tuesday] }

  it('comes on the third Readiness flag of the Week, as structured facts', () => {
    expect(lighterOf(readiness('2026-11-24', flags))).toEqual([])
    expect(lighterOf(readiness('2026-11-25', flags))).toEqual([
      {
        id: 'lighter-week-w3',
        kind: 'lighter-week',
        week: 3,
        sessionId: null,
        date: '2026-11-25',
        from: { volumePercent: 100 },
        to: { volumePercent: 67 },
        trigger: {
          flags: [
            { date: '2026-11-23', painScore: 3, sleepMinutes: null },
            { date: '2026-11-24', painScore: null, sleepMinutes: 320 },
            { date: '2026-11-25', painScore: 4, sleepMinutes: null },
          ],
        },
        decision: 'open',
        decidedOn: null,
      },
    ])
    // It stands for the rest of the Week, from the day of the third flag.
    expect(lighterOf(readiness('2026-11-28', flags))[0]).toMatchObject({ date: '2026-11-25' })
    // The Monday after is a new Week: no flags yet.
    expect(lighterOf(readiness('2026-11-30', flags))).toEqual([])
  })

  it('counts a day once, whatever flagged it', () => {
    const sameDay = { reports: [monday, wednesday], nights: [night('2026-11-23', 300), night('2026-11-25', 300)] }
    expect(lighterOf(readiness('2026-11-25', sameDay))).toEqual([])
    expect(lighterOf(readiness('2026-11-26', { ...sameDay, nights: [...sameDay.nights, night('2026-11-26', 330)] }))).toHaveLength(1)
  })

  it('counts only what the Readiness rules act on: pain 3 or rising, sleep under 6 hours', () => {
    const calm = {
      reports: [pain('2026-11-23', 2), pain('2026-11-25', 2)],
      nights: [night('2026-11-24', 360), night('2026-11-26', 450)],
    }
    expect(lighterOf(readiness('2026-11-26', calm))).toEqual([])
    // Rising pain is a flag even under 3: up from last Sunday's 0.
    const rising = { reports: [pain('2026-11-22', 0), pain('2026-11-23', 1), pain('2026-11-24', 2), pain('2026-11-25', 3)], nights: [] }
    expect(lighterOf(readiness('2026-11-25', rising))[0].trigger.flags).toEqual([
      { date: '2026-11-23', painScore: 1, sleepMinutes: null },
      { date: '2026-11-24', painScore: 2, sleepMinutes: null },
      { date: '2026-11-25', painScore: 3, sleepMinutes: null },
    ])
  })

  it('counts only the Week holding today: last Sunday’s flag is last Week’s', () => {
    const across = { reports: [pain('2026-11-22', 4), monday], nights: [tuesday] }
    expect(lighterOf(readiness('2026-11-25', across))).toEqual([])
  })

  it('changes nothing until Accepted, and the rest of the Week once it is', () => {
    const hyroxMondayDone = [log(3, 'hyrox-a', '2026-11-23')]
    const open = readiness('2026-11-25', { ...flags, logs: hyroxMondayDone })
    expect(open.bucket.find((e) => e.session.id === 'hyrox-b')!.session.minutes).toBe(45)

    const accepted = readiness('2026-11-25', { ...flags, logs: hyroxMondayDone, decisions: [lighterDecision('accepted')] })
    expect(lighterOf(accepted)[0]).toMatchObject({ decision: 'accepted', decidedOn: '2026-11-25' })
    // HYROX A was done before the flags added up: it stays as written.
    expect(accepted.bucket.map((e) => e.session.minutes)).toEqual([45, 30, 30, 30, 20])
    expect(accepted.bucket.find((e) => e.session.id === 'run')!.session.headline).toBe('2 × 8′')

    const kept = readiness('2026-11-25', { ...flags, logs: hyroxMondayDone, decisions: [lighterDecision('kept')] })
    expect(kept.bucket.map((e) => e.session.minutes)).toEqual([45, 45, 45, 45, 30])
  })

  it('shows the lighter Week on other screens too, given the nights', () => {
    const decisions = [lighterDecision('accepted')]
    const today = localDate('2026-11-25')
    expect(prescribedWeek(program, 3, [], decisions, undefined, { ...flags, today })?.sessions[1].minutes).toBe(30)
    expect(prescribedWeek(program, 3, [], decisions, undefined, { reports: flags.reports, today })?.sessions[1].minutes).toBe(45)
  })

  it('never comes in a Deload week or the Taper', () => {
    // Week 5: Mon 7 Dec.
    const deload = { reports: [pain('2026-12-07', 4), pain('2026-12-09', 5)], nights: [night('2026-12-08', 300)] }
    expect(lighterOf(readiness('2026-12-09', deload))).toEqual([])
    // Week 22: Mon 5 Apr.
    const taper = { reports: [pain('2027-04-05', 4), pain('2027-04-07', 5)], nights: [night('2027-04-06', 300)] }
    const day = readiness('2027-04-07', taper)
    expect(day.position).toMatchObject({ week: 22, phase: 'taper' })
    expect(lighterOf(day)).toEqual([])
  })
})

describe('Activities', () => {
  const run = (start: string, end: string) =>
    parseActivity({ type: 'Running', start, end, distanceKm: 8, heartRates: '150\n160' }, '2026-11-26T12:00:00.000Z')
  const today = localDate('2026-11-25')
  const base = { program, today, logs: caughtUpBefore(today) }

  it('attaches the watch’s workout to the Session logged that day, on its Bucket row', () => {
    const activity = run('2026-11-25T07:00:00-05:00', '2026-11-25T07:45:00-05:00')
    const day = coach({ ...base, logs: [...base.logs, log(3, 'run', '2026-11-25')], activities: [activity] })
    expect(day.bucket.find((e) => e.session.id === 'run')?.activity).toEqual(activity)
    expect(day.bucket.filter((e) => e.activity)).toHaveLength(1)
    expect(day.activityQuestions).toEqual([])
  })

  it('asks which Session a run was while the Run and the Easy run are Planned, until the athlete answers', () => {
    const activity = run('2026-11-25T07:00:00-05:00', '2026-11-25T07:45:00-05:00')
    const day = coach({ ...base, activities: [activity] })
    expect(day.activityQuestions.map((q) => q.candidates.map((c) => c.session.id))).toEqual([['run', 'easy']])
    const answered = coach({
      ...base,
      activities: [activity],
      activityAnswers: [{ activityId: activity.id, week: 3, sessionId: 'run', updatedAt: '2026-11-25T13:00:00.000Z' }],
    })
    expect(answered.activityQuestions).toEqual([])
    expect(answered.bucket.find((e) => e.session.id === 'run')?.activity?.id).toBe(activity.id)
  })

  it('offers to log a Session the athlete attached a workout to, until it is logged', () => {
    const activity = run('2026-11-24T07:00:00-05:00', '2026-11-24T07:45:00-05:00')
    const activityAnswers = [{ activityId: activity.id, week: 3, sessionId: 'run', updatedAt: '2026-11-25T13:00:00.000Z' }]
    const answered = coach({ ...base, activities: [activity], activityAnswers })
    expect(answered.activitiesAttached).toMatchObject([{ sessionId: 'run', by: 'athlete', logged: false }])
    expect(answered.bucket.find((e) => e.session.id === 'run')?.state).not.toBe('done')
    const logged = coach({ ...base, logs: [...base.logs, log(3, 'run', '2026-11-24')], activities: [activity], activityAnswers })
    expect(logged.activitiesAttached).toEqual([])
  })

  it('says what it attached on its own today, logged or not', () => {
    const activity = run('2026-11-25T07:00:00-05:00', '2026-11-25T07:45:00-05:00')
    const day = coach({ ...base, logs: [...base.logs, log(3, 'run', '2026-11-25')], activities: [activity] })
    expect(day.activitiesAttached).toMatchObject([{ sessionId: 'run', by: 'coach', logged: true }])
  })

  describe('in Catch-up (ADR-0007)', () => {
    // A Week 2 Tuesday. Week 1's Run (Key) is Late; its other required Sessions are done.
    const tuesday = localDate('2026-11-17')
    const week1 = ['hyrox-a', 'hyrox-b', 'strength'].map((id) => log(1, id, '2026-11-10'))
    const watchRun = run('2026-11-17T07:00:00-05:00', '2026-11-17T07:45:00-05:00')

    it('attaches a run to the one Late session it fits, on its Late row', () => {
      const week2Runs = ['compromised-run-test', 'easy'].map((id) => log(2, id, '2026-11-16'))
      const day = coach({ program, today: tuesday, logs: [...week1, ...week2Runs], activities: [watchRun] })
      expect(day.bucket.find((e) => e.late && e.session.id === 'run')?.activity).toEqual(watchRun)
      expect(day.activityQuestions).toEqual([])
      expect(day.activitiesAttached).toMatchObject([{ week: 1, sessionId: 'run', by: 'coach', logged: false }])
    })

    it('asks between a Late session and one of the current Week, each with its Week', () => {
      const day = coach({ program, today: tuesday, logs: [...week1, log(2, 'easy', '2026-11-16')], activities: [watchRun] })
      expect(day.activityQuestions.map((q) => q.candidates.map((c) => `${c.week}/${c.session.id}`))).toEqual([
        ['1/run', '2/compromised-run-test'],
      ])
      expect(day.bucket.filter((e) => e.activity)).toEqual([])
    })
  })

  it('stops asking about a workout a week old', () => {
    const activity = run('2026-11-23T07:00:00-05:00', '2026-11-23T07:45:00-05:00')
    expect(coach({ ...base, today: localDate('2026-11-29'), activities: [activity] }).activityQuestions).toHaveLength(1)
    expect(coach({ ...base, today: localDate('2026-11-30'), activities: [activity] }).activityQuestions).toEqual([])
  })
})
