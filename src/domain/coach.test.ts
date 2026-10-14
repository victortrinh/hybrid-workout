import { describe, expect, it } from 'vitest'
import { daysBetween, isoWeekday, localDate, localDateIn, type LocalDate } from './calendar'
import { DEFAULT_EQUIPMENT, equipWeek } from './equipment'
import { coach, findWeek, keyDeadline, prescribedWeek, programStart, weekOutcome, type CoachInput } from './coach'
import type { LoggedStatus, SessionLog } from './log'
import { program } from './program/program'
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
          intervals: [],
          sets: [],
          updatedAt: '2026-10-01T12:00:00.000Z',
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

// ---------------------------------------------------------------------------
// With Session logs. Week 3 runs Mon 2 – Sun 8 Nov: Speed, Strength,
// Threshold (Key), HYROX, Easy run (Optional). Week 4 is a Deload week whose
// Threshold is an Easy run that isn't Optional.

let nextId = 0
function log(week: number, sessionId: string, date: string, status: LoggedStatus = 'done', updatedAt = '2026-11-01T12:00:00.000Z'): SessionLog {
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
    intervals: [],
    sets: [],
    updatedAt,
  }
}

const withLogs = (iso: string, logs: SessionLog[], picked: CoachInput['picked'] = null) =>
  coach({ program, today: localDate(iso), logs: [...keysDoneBefore(localDate(iso)), ...logs], picked })
const states = (day: ReturnType<typeof coach>) => Object.fromEntries(day.bucket.map((e) => [e.session.id, e.state]))

describe('the Bucket', () => {
  it('is Next for Up next and Planned for the rest while nothing is logged', () => {
    expect(states(on('2026-11-04'))).toEqual({
      speed: 'next',
      strength: 'planned',
      threshold: 'planned',
      hyrox: 'planned',
      easy: 'planned',
    })
  })

  it('shows each logged Session as Done, Partial, Skipped or Swapped, with its log', () => {
    const logs = [
      log(3, 'speed', '2026-11-02', 'done'),
      log(3, 'strength', '2026-11-02', 'partial'),
      log(3, 'threshold', '2026-11-03', 'skipped'),
      log(3, 'hyrox', '2026-11-03', 'swapped'),
    ]
    const day = withLogs('2026-11-04', logs)
    expect(states(day)).toEqual({ speed: 'done', strength: 'partial', threshold: 'skipped', hyrox: 'swapped', easy: 'next' })
    expect(day.bucket[0].log).toBe(logs[0])
    expect(day.bucket[4].log).toBeNull()
  })

  it('goes by the latest edit when a Session has more than one log', () => {
    const logs = [
      log(3, 'speed', '2026-11-02', 'done', '2026-11-02T20:00:00.000Z'),
      log(3, 'speed', '2026-11-02', 'partial', '2026-11-03T08:00:00.000Z'),
    ]
    expect(states(withLogs('2026-11-04', logs)).speed).toBe('partial')
  })

  it('ignores logs from other Weeks', () => {
    expect(states(withLogs('2026-11-04', [log(2, 'strength', '2026-10-27')])).strength).toBe('planned')
  })

  it('shows Week 1 all Planned before the Program starts', () => {
    expect(new Set(Object.values(states(on('2026-10-13'))))).toEqual(new Set(['planned']))
  })

  it('is empty after the Program', () => {
    expect(on('2027-05-01').bucket).toEqual([])
  })
})

describe('Up next with Session logs', () => {
  it('moves past logged Sessions to the oldest-waiting one, in Bucket order', () => {
    const day = withLogs('2026-11-04', [log(3, 'speed', '2026-11-02')])
    expect(day.upNext?.id).toBe('strength')
    expect(day.rest).toBeNull()
  })

  it('moves past Skipped and Swapped Sessions too', () => {
    const logs = [log(3, 'speed', '2026-11-02', 'skipped'), log(3, 'strength', '2026-11-02', 'swapped')]
    expect(withLogs('2026-11-04', logs).upNext?.id).toBe('threshold')
  })

  describe('no two Hard sessions on consecutive days when avoidable', () => {
    it('rests the day after a Hard session when the Week can still fit the rest', () => {
      // Thursday: Threshold and HYROX left, four days to fit them in.
      const day = withLogs('2026-11-05', [log(3, 'speed', '2026-11-02'), log(3, 'strength', '2026-11-04')])
      expect(day.upNext).toBeNull()
      expect(day.rest).toEqual({ kind: 'hard-yesterday' })
    })

    it('goes Hard anyway when resting would leave too few days', () => {
      // Wednesday: Strength, Threshold and HYROX left in five days. Resting today
      // leaves four, which hold only two Hard sessions apart.
      const day = withLogs('2026-11-04', [log(3, 'speed', '2026-11-03')])
      expect(day.upNext?.id).toBe('strength')
    })

    it('stops at one Hard session a day when the Week has room', () => {
      const day = withLogs('2026-11-02', [log(3, 'speed', '2026-11-02')])
      expect(day.upNext).toBeNull()
      expect(day.rest).toEqual({ kind: 'hard-today' })
    })

    it('allows a second Hard session today when the Week runs out otherwise', () => {
      const logs = [log(3, 'speed', '2026-11-02'), log(3, 'strength', '2026-11-04'), log(3, 'threshold', '2026-11-08')]
      expect(withLogs('2026-11-08', logs).upNext?.id).toBe('hyrox')
    })

    it('picks the Easy run that is not Optional over a Hard session after a Hard day', () => {
      // Week 4, a Deload week: Speed done Monday, so Tuesday is the Easy run before Strength.
      const day = withLogs('2026-11-10', [log(4, 'speed', '2026-11-09')])
      expect(day.upNext).toMatchObject({ id: 'easy-deload', type: 'easy', optional: false })
    })

    it('counts the Hard day before Monday across the Week boundary', () => {
      // HYROX done Sunday of Week 2; Week 3 starts with four Hard sessions in seven days.
      const day = withLogs('2026-11-02', [log(2, 'hyrox', '2026-11-01')])
      expect(day.upNext?.id).not.toBe('speed')
    })

    it('does not count Skipped or Swapped Sessions as a Hard day', () => {
      const day = withLogs('2026-11-05', [log(3, 'speed', '2026-11-02'), log(3, 'strength', '2026-11-04', 'skipped')])
      expect(day.upNext?.id).toBe('threshold')
    })

    it('counts a Partial Session as a Hard day', () => {
      const day = withLogs('2026-11-05', [log(3, 'speed', '2026-11-02'), log(3, 'strength', '2026-11-04', 'partial')])
      expect(day.rest).toEqual({ kind: 'hard-yesterday' })
    })
  })

  describe('never Speed the day after HYROX or Strength', () => {
    it('skips Speed for the next Session after Strength yesterday', () => {
      // Thursday, too little room to rest: Speed, Threshold and HYROX left in four days.
      const day = withLogs('2026-11-05', [log(3, 'strength', '2026-11-04')])
      expect(day.upNext?.id).toBe('threshold')
    })

    it('skips Speed after HYROX on the Sunday before', () => {
      const day = withLogs('2026-11-02', [log(2, 'hyrox', '2026-11-01')])
      expect(day.upNext?.id).toBe('strength')
    })

    it('treats a 5K test as Speed', () => {
      // Week 2 opens with the baseline 5K test; HYROX was done the Sunday before.
      const day = withLogs('2026-10-26', [log(1, 'hyrox', '2026-10-25')])
      expect(day.upNext?.id).toBe('strength')
    })

    it('rests rather than putting Speed after Strength, even when Speed is all that is left', () => {
      const logs = [
        log(3, 'threshold', '2026-11-02'),
        log(3, 'hyrox', '2026-11-04'),
        log(3, 'strength', '2026-11-07'),
      ]
      const day = withLogs('2026-11-08', logs)
      expect(day.upNext).toBeNull()
      expect(day.rest).toEqual({ kind: 'speed-after-load' })
    })

    it('keeps Speed off the same day as Strength too', () => {
      const logs = [log(3, 'threshold', '2026-11-02'), log(3, 'hyrox', '2026-11-04'), log(3, 'strength', '2026-11-08')]
      expect(withLogs('2026-11-08', logs).rest).toEqual({ kind: 'speed-after-load' })
    })

    it('allows Speed the day after Threshold', () => {
      const day = withLogs('2026-11-06', [log(3, 'strength', '2026-11-02'), log(3, 'threshold', '2026-11-05')])
      expect(day.upNext?.id).toBe('speed')
    })
  })

  describe('Strength and an Easy run on the same day', () => {
    it('offers the Easy run after Strength the same day', () => {
      const day = withLogs('2026-11-11', [log(4, 'speed', '2026-11-09'), log(4, 'strength', '2026-11-11')])
      expect(day.upNext?.id).toBe('easy-deload')
    })

    it('offers the Optional Easy run after Strength once nothing else is left', () => {
      const logs = [
        log(3, 'speed', '2026-11-02'),
        log(3, 'threshold', '2026-11-04'),
        log(3, 'hyrox', '2026-11-06'),
        log(3, 'strength', '2026-11-08'),
      ]
      expect(withLogs('2026-11-08', logs).upNext?.id).toBe('easy')
    })
  })

  describe('the Optional session', () => {
    it('is never Up next on a rest day while other Sessions remain', () => {
      const day = withLogs('2026-11-05', [log(3, 'speed', '2026-11-02'), log(3, 'strength', '2026-11-04')])
      expect(day.upNext).toBeNull()
    })

    it('is Up next once every other Session is logged', () => {
      const logs = ['speed', 'strength', 'threshold', 'hyrox'].map((id, i) => log(3, id, `2026-11-0${2 + i * 2}`))
      expect(withLogs('2026-11-08', logs).upNext?.id).toBe('easy')
    })

    it('leaves the Week done once it is logged as well', () => {
      const logs = ['speed', 'strength', 'threshold', 'hyrox', 'easy'].map((id) => log(3, id, '2026-11-02'))
      const day = withLogs('2026-11-08', logs)
      expect(day.upNext).toBeNull()
      expect(day.rest).toEqual({ kind: 'week-done' })
    })
  })

  describe('a Session picked from the Bucket', () => {
    const picked = (sessionId: string, date = '2026-11-04', week = 3) => ({ date: localDate(date), week, sessionId })

    it('becomes Up next, and the previous Up next goes back to Planned', () => {
      const day = withLogs('2026-11-04', [], picked('hyrox'))
      expect(day.upNext?.id).toBe('hyrox')
      expect(states(day)).toMatchObject({ speed: 'planned', hyrox: 'next' })
    })

    it('overrides the spacing rules: the athlete decides', () => {
      const day = withLogs('2026-11-05', [log(3, 'strength', '2026-11-04')], picked('speed', '2026-11-05'))
      expect(day.upNext?.id).toBe('speed')
    })

    it('can be the Optional session', () => {
      expect(withLogs('2026-11-04', [], picked('easy')).upNext?.id).toBe('easy')
    })

    it('lasts only for the day it was picked', () => {
      expect(withLogs('2026-11-05', [], picked('hyrox', '2026-11-04')).upNext?.id).toBe('speed')
    })

    it('gives way once it is logged', () => {
      const day = withLogs('2026-11-04', [log(3, 'threshold', '2026-11-04')], picked('threshold'))
      expect(day.upNext?.id).toBe('speed')
    })
  })

  describe('Race week', () => {
    it('offers the shakeout before Race day', () => {
      expect(on('2027-04-19').upNext?.id).toBe('shakeout')
    })

    it('waits for Race day once the shakeout is logged', () => {
      const day = withLogs('2027-04-20', [log(27, 'shakeout', '2027-04-19')])
      expect(day.upNext).toBeNull()
      expect(day.rest).toMatchObject({ kind: 'waiting', session: { id: 'race' }, date: '2027-04-21' })
    })

    it('is the race on Race day, whatever was done the day before', () => {
      const day = withLogs('2027-04-21', [log(27, 'shakeout', '2027-04-20')])
      expect(day.upNext?.id).toBe('race')
    })
  })
})

// ---------------------------------------------------------------------------
// Week rollover. Week 3's Key session is Threshold; Week 4 (Mon 9 – Sun 15 Nov)
// is a Deload week with no Key session.

const week = (n: number) => findWeek(program, n)!
const outcome = (n: number, iso: string, logs: SessionLog[] = []) =>
  weekOutcome(program, week(n), logs, localDate(iso))
const missed = (o: ReturnType<typeof outcome>) => o.skipped.map(({ session, by }) => `${session.id} by ${by}`)
/** Everything before Week 3 settled; Week 3's own logs as given. */
const inWeek4 = (iso: string, logs: SessionLog[] = []) =>
  coach({ program, today: localDate(iso), logs: [...keysDoneBefore(localDate('2026-11-02')), ...logs] })

describe('the Key session carries over', () => {
  it('into the next Week until Wednesday, first in the Bucket and Up next', () => {
    for (const iso of ['2026-11-09', '2026-11-10', '2026-11-11']) {
      const day = inWeek4(iso)
      expect(day.bucket[0]).toMatchObject({ week: 3, session: { id: 'threshold', key: true }, carriedUntil: '2026-11-11' })
      expect(day.bucket.slice(1).map((e) => [e.week, e.carriedUntil])).toEqual(Array(5).fill([4, null]))
      expect(day.upNext).toMatchObject({ id: 'threshold', headline: '2 × 12′' })
      expect(day.bucket[0].state).toBe('next')
    }
  })

  it('is gone on Thursday, Skipped by the Coach', () => {
    const day = inWeek4('2026-11-12')
    expect(day.bucket.map((e) => e.week)).toEqual([4, 4, 4, 4, 4])
    expect(missed(outcome(3, '2026-11-12'))).toContain('threshold by coach')
    expect(outcome(3, '2026-11-12').carried).toBeNull()
  })

  it('shows as Done once logged in the carry-over, and is no miss', () => {
    const done = log(3, 'threshold', '2026-11-10')
    const day = inWeek4('2026-11-11', [done])
    expect(day.bucket[0]).toMatchObject({ week: 3, state: 'done', log: done })
    expect(day.upNext?.id).not.toBe('threshold')
    expect(missed(outcome(3, '2026-11-12', [done]))).not.toContain('threshold by coach')
  })

  it('counts toward the spacing rules on the day it is done', () => {
    // Threshold carried and done Monday of Week 4: Tuesday is the Deload's Easy run.
    const day = inWeek4('2026-11-10', [log(3, 'threshold', '2026-11-09')])
    expect(day.upNext?.id).toBe('easy-deload')
  })

  it('can be picked from the Bucket like any other Session', () => {
    const day = coach({
      program,
      today: localDate('2026-11-09'),
      logs: keysDoneBefore(localDate('2026-11-02')),
      picked: { date: localDate('2026-11-09'), week: 4, sessionId: 'hyrox' },
    })
    expect(day.upNext?.id).toBe('hyrox')
    expect(day.bucket[0]).toMatchObject({ week: 3, state: 'planned' })
  })

  it('is the only Session that carries: nothing else does, the Optional session least of all', () => {
    const day = inWeek4('2026-11-09')
    expect(day.bucket.filter((e) => e.carriedUntil)).toHaveLength(1)
    expect(outcome(3, '2026-11-09').carried?.session.id).toBe('threshold')
  })

  it('stops at Wednesday whichever Week it is', () => {
    expect(keyDeadline(program, week(1))).toBe('2026-10-28')
    expect(keyDeadline(program, week(14))).toBe('2027-01-27')
  })

  it('never spills from the Taper into Race week', () => {
    expect(keyDeadline(program, week(26))).toBe('2027-04-18')
    const day = coach({ program, today: localDate('2027-04-19'), logs: keysDoneBefore(localDate('2027-04-12')) })
    expect(day.bucket.map((e) => e.week)).toEqual([27, 27])
    expect(missed(outcome(26, '2027-04-19'))).toContain('speed by coach')
  })
})

describe('Sessions not done by Sunday', () => {
  it('stay open through Sunday, in America/Toronto', () => {
    expect(outcome(3, '2026-11-08')).toEqual({ skipped: [], carried: null })
    // 23:59 Sunday in Toronto is already Monday in UTC; the Week is still open.
    expect(outcome(3, localDateIn(new Date('2026-11-09T04:59:59Z')))).toEqual({ skipped: [], carried: null })
  })

  it('become Skipped at the end of Sunday, apart from the Key session', () => {
    const o = outcome(3, localDateIn(new Date('2026-11-09T05:00:00Z')))
    expect(missed(o)).toEqual(['speed by coach', 'strength by coach', 'hyrox by coach'])
    expect(o.carried).toEqual({ session: expect.objectContaining({ id: 'threshold' }), until: '2026-11-11' })
  })

  it('leave the Optional session alone: missing it is not a miss', () => {
    expect(missed(outcome(3, '2026-11-20'))).not.toContain('easy by coach')
    expect(missed(outcome(3, '2026-11-20', [log(3, 'easy', '2026-11-03', 'skipped')]))).not.toContain('easy by athlete')
  })

  it('count a Skipped log at once, and never Done, Partial or Swapped', () => {
    const logs = [
      log(3, 'speed', '2026-11-02', 'skipped'),
      log(3, 'strength', '2026-11-03', 'partial'),
      log(3, 'threshold', '2026-11-04', 'swapped'),
      log(3, 'hyrox', '2026-11-05', 'done'),
    ]
    expect(missed(outcome(3, '2026-11-04', logs))).toEqual(['speed by athlete'])
    expect(missed(outcome(3, '2026-11-20', logs))).toEqual(['speed by athlete'])
  })

  it('leave a Deload week, with no Key session, nothing to carry', () => {
    const o = outcome(4, '2026-11-16')
    expect(o.carried).toBeNull()
    expect(missed(o)).toEqual(['speed by coach', 'strength by coach', 'easy-deload by coach', 'hyrox by coach'])
  })
})

// ---------------------------------------------------------------------------
// The lighter re-entry Week. Week 10 (Mon 21 – Sun 27 Dec): Speed is Key.
// Week 11 (Mon 28 Dec – Sun 3 Jan): Speed 4 × 4′, Key.

const week10 = (statuses: Partial<Record<string, LoggedStatus>>) =>
  Object.entries(statuses).map(([id, status], i) => log(10, id, `2026-12-2${1 + i}`, status))
const TWO_SKIPPED = { speed: 'done', strength: 'done', threshold: 'skipped', hyrox: 'skipped' } as const

function decided(decision: Decision, date = '2026-12-29', updatedAt = '2026-12-29T12:00:00.000Z'): SuggestionDecision {
  return { id: 're-entry-w11', decision, date: localDate(date), updatedAt }
}

const inWeek11 = (logs: SessionLog[], decisions: SuggestionDecision[] = [], iso = '2026-12-29') =>
  coach({ program, today: localDate(iso), logs: [...keysDoneBefore(localDate('2026-12-21')), ...logs], decisions })

describe('the re-entry Suggestion', () => {
  it('comes with two Skipped Sessions last Week, as structured facts', () => {
    expect(inWeek11(week10(TWO_SKIPPED)).suggestions).toEqual([
      {
        id: 're-entry-w11',
        kind: 're-entry',
        week: 11,
        sessionId: null,
        date: '2026-12-28',
        from: { volumePercent: 100 },
        to: { volumePercent: 67 },
        trigger: {
          week: 10,
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
    expect(inWeek11(week10({ ...TWO_SKIPPED, threshold: 'done' })).suggestions).toEqual([])
  })

  it('counts Sessions the Coach Skipped at the end of Sunday', () => {
    const day = inWeek11(week10({ speed: 'done', strength: 'done' }))
    const [reEntry] = day.suggestions
    expect(reEntry.kind === 're-entry' && reEntry.trigger.skipped.map((s) => s.sessionId)).toEqual(['threshold', 'hyrox'])
  })

  it('does not count the Key session while it is carried over', () => {
    // Speed (Key) and Strength undone: Speed carries, so only Strength is Skipped.
    expect(inWeek11(week10({ threshold: 'done', hyrox: 'done' })).suggestions).toEqual([])
    // Even after its carry-over runs out: the count is taken as the Week closed.
    expect(inWeek11(week10({ threshold: 'done', hyrox: 'done' }), [], '2026-12-31').suggestions).toEqual([])
  })

  it('is about this Week only: gone the Week after', () => {
    const logs = [...week10(TWO_SKIPPED), ...['speed', 'strength', 'easy-deload', 'hyrox'].map((id) => log(12, id, '2027-01-04'))]
    expect(inWeek11(logs, [], '2027-01-04').suggestions.map((s) => s.id)).not.toContain('re-entry-w11')
  })

  it('never lightens a Deload week, nor the Taper or Race week', () => {
    // Week 3 with two Skipped, then Week 4, a Deload.
    const deload = coach({
      program,
      today: localDate('2026-11-10'),
      logs: [...keysDoneBefore(localDate('2026-11-02')), log(3, 'speed', '2026-11-02', 'skipped'), log(3, 'hyrox', '2026-11-02', 'skipped')],
    })
    expect(deload.suggestions).toEqual([])
    // Nothing logged in Week 25 or 26.
    expect(coach({ program, today: localDate('2027-04-13'), logs: keysDoneBefore(localDate('2027-04-13')) }).suggestions).toEqual([])
    expect(coach({ program, today: localDate('2027-04-20'), logs: keysDoneBefore(localDate('2027-04-20')) }).suggestions).toEqual([])
  })

  it('changes nothing until it is Accepted', () => {
    const day = inWeek11(week10(TWO_SKIPPED))
    expect(day.upNext).toMatchObject({ id: 'speed', headline: '4 × 4′', minutes: 45 })
    expect(day.week).toEqual(equipWeek(findWeek(program, 11)!, DEFAULT_EQUIPMENT))
  })

  it('lightens every Prescription of the Week by a third once Accepted', () => {
    const day = inWeek11(week10(TWO_SKIPPED), [decided('accepted')])
    expect(day.suggestions[0]).toMatchObject({ decision: 'accepted', decidedOn: '2026-12-29' })
    expect(day.upNext).toMatchObject({ id: 'speed', headline: '3 × 4′', minutes: 30 })
    expect(day.bucket.map((e) => e.session.minutes)).toEqual([30, 30, 30, 34, 27])
    const intervals = day.upNext!.blocks.find((b) => b.main)!.exercises[0].prescription
    expect(intervals).toMatchObject({ kind: 'intervals', reps: 3, workSeconds: 240 })
  })

  it('keeps the Program as written when Kept, and again after Undo', () => {
    for (const d of [decided('kept'), decided('open')]) {
      const day = inWeek11(week10(TWO_SKIPPED), [d])
      expect(day.suggestions[0].decision).toBe(d.decision)
      expect(day.upNext).toMatchObject({ headline: '4 × 4′', minutes: 45 })
    }
  })

  it('shows the lighter Week on other screens too', () => {
    const logs = [...keysDoneBefore(localDate('2026-12-21')), ...week10(TWO_SKIPPED)]
    expect(prescribedWeek(program, 11, logs, [decided('accepted')])?.sessions[0].headline).toBe('3 × 4′')
    expect(prescribedWeek(program, 11, logs, [decided('kept')])?.sessions[0].headline).toBe('4 × 4′')
    expect(prescribedWeek(program, 10, logs, [decided('accepted')])).toEqual(equipWeek(findWeek(program, 10)!, DEFAULT_EQUIPMENT))
  })
})
