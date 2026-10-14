import { describe, expect, it } from 'vitest'
import { isoWeekday, localDate, localDateIn } from './calendar'
import { coach, programStart, type CoachInput } from './coach'
import type { LoggedStatus, SessionLog } from './log'
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
    updatedAt,
  }
}

const withLogs = (iso: string, logs: SessionLog[], picked: CoachInput['picked'] = null) =>
  coach({ program, today: localDate(iso), logs, picked })
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
