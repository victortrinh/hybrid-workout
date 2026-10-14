import { describe, expect, it } from 'vitest'
import { localDate } from './calendar'
import {
  activityKind,
  answerFor,
  isTreadmill,
  matchActivities,
  mergeAnswers,
  parseActivity,
  parseActivityAnswer,
  type Activity,
  type ActivityAnswer,
} from './activity'
import type { SessionLog } from './log'
import { program } from './program/program'

const AT = '2026-11-04T20:00:00.000Z'
/** A Week 3 workout: Wednesday 4 November 2026, 7:12 in Toronto. */
const body = {
  type: 'Running',
  start: '2026-11-04T07:12:00-05:00',
  end: '2026-11-04T07:54:30-05:00',
  distanceKm: 8.12,
  heartRates: '140\n152\n161\n171\n148',
}

describe('parseActivity', () => {
  it('takes what the Shortcut sends: its day in Toronto, minutes, distance and heart rate from the samples', () => {
    expect(parseActivity(body, AT)).toEqual({
      id: '2026-11-04T12:12:00Z',
      date: '2026-11-04',
      startedAt: '2026-11-04T12:12:00Z',
      workoutType: 'Running',
      kind: 'run',
      minutes: 43,
      distanceMeters: 8120,
      averageHeartRate: 154,
      maxHeartRate: 171,
      indoor: null,
      receivedAt: AT,
    })
  })

  it('keys an Activity on its start, so a resend replaces it', () => {
    expect(parseActivity({ ...body, start: '2026-11-04T12:12:00.000Z' }, AT).id).toBe('2026-11-04T12:12:00Z')
  })

  it('takes a late-evening workout as its day in Toronto, not in UTC', () => {
    expect(parseActivity({ ...body, start: '2026-11-05T01:30:00Z', end: '2026-11-05T02:10:00Z' }, AT).date).toBe(
      '2026-11-04',
    )
  })

  it('takes distance as Shortcuts writes it, with its unit', () => {
    expect(parseActivity({ ...body, distanceKm: undefined, distance: '8.12 km' }, AT).distanceMeters).toBe(8120)
    expect(parseActivity({ ...body, distanceKm: undefined, distance: '8120 m' }, AT).distanceMeters).toBe(8120)
    expect(parseActivity({ ...body, distanceKm: undefined, distance: '5 mi' }, AT).distanceMeters).toBe(8047)
    expect(parseActivity({ ...body, distanceKm: undefined, distance: '8,12' }, AT).distanceMeters).toBe(8120)
    expect(() => parseActivity({ ...body, distance: 'far' }, AT)).toThrow(/distance/)
  })

  it('adds up distance samples per device and keeps the device with the most: phone and watch never count twice', () => {
    const samples = ['0.52 km Victor’s Apple Watch', '0.48 Victor’s Apple Watch', '0.95 km Victor’s iPhone', '', '7.1 Victor’s Apple Watch'].join('\n')
    expect(parseActivity({ ...body, distanceKm: undefined, distanceSamples: samples }, AT).distanceMeters).toBe(8100)
    expect(parseActivity({ ...body, distanceKm: undefined, distanceSamples: '500 m Watch\n0.2 mi Watch' }, AT).distanceMeters).toBe(822)
    expect(parseActivity({ ...body, distanceKm: undefined, distanceSamples: '' }, AT).distanceMeters).toBeNull()
    expect(() => parseActivity({ ...body, distanceSamples: 'lots Watch' }, AT)).toThrow(/distanceSamples/)
  })

  it('keeps only the samples within the workout, by each line’s own time: the Shortcut reads a fixed window', () => {
    const heartRates = [
      '88 2026-11-04T06:30:00-05:00', // before the start
      '150 2026-11-04T07:20:00-05:00',
      '160 count/min 2026-11-04T07:40:00-05:00',
      '95 2026-11-04T08:30:00-05:00', // after the end
    ].join('\n')
    const distanceSamples = [
      '0.40 km 2026-11-04T06:50:00-05:00 Victor’s iPhone', // the walk to the gym
      '4.00 km 2026-11-04T07:20:00-05:00 Victor’s Apple Watch',
      '4.10 km 2026-11-04T07:45:00-05:00 Victor’s Apple Watch',
    ].join('\n')
    expect(parseActivity({ ...body, distanceKm: undefined, heartRates, distanceSamples }, AT)).toMatchObject({
      averageHeartRate: 155,
      maxHeartRate: 160,
      distanceMeters: 8100,
    })
  })

  it('takes a start sent as the file’s text, trailing line break and all', () => {
    expect(parseActivity({ ...body, start: '2026-11-04T07:12:00-05:00\n' }, AT).id).toBe('2026-11-04T12:12:00Z')
  })

  it('takes metres, heart rates as a list or an average, and no distance or heart rate at all', () => {
    expect(parseActivity({ ...body, distanceKm: undefined, distanceMeters: 8120.4 }, AT).distanceMeters).toBe(8120)
    expect(parseActivity({ ...body, heartRates: [150, '160'] }, AT)).toMatchObject({ averageHeartRate: 155, maxHeartRate: 160 })
    expect(parseActivity({ ...body, heartRates: undefined, averageHeartRate: 151.6 }, AT)).toMatchObject({
      averageHeartRate: 152,
      maxHeartRate: null,
    })
    for (const missing of [undefined, null, '', 0]) {
      expect(parseActivity({ ...body, distanceKm: missing, heartRates: missing }, AT)).toMatchObject({
        distanceMeters: null,
        averageHeartRate: null,
        maxHeartRate: null,
      })
    }
  })

  it('reads indoor from the flag, or from an Indoor Run type', () => {
    expect(parseActivity({ ...body, indoor: true }, AT).indoor).toBe(true)
    expect(parseActivity({ ...body, indoor: 'No' }, AT).indoor).toBe(false)
    expect(parseActivity({ ...body, indoor: 'Yes' }, AT).indoor).toBe(true)
    expect(parseActivity({ ...body, type: 'Indoor Run' }, AT)).toMatchObject({ indoor: true, kind: 'run' })
    expect(parseActivity({ ...body, type: 'Outdoor Run' }, AT)).toMatchObject({ indoor: false, kind: 'run' })
  })

  it('refuses what isn’t a workout', () => {
    expect(() => parseActivity({ ...body, start: 'Oct 14, 2026 at 2:28 PM' }, AT)).toThrow(
      'start must be an ISO 8601 date and time, like 2026-11-04T07:12:00-05:00 (got "Oct 14, 2026 at 2:28 PM")',
    )
    expect(() => parseActivity({ ...body, start: undefined }, AT)).toThrow(/\(got nothing\)/)
    expect(() => parseActivity({ ...body, end: '2026-11-04T07:00:00-05:00' }, AT)).toThrow(/end/)
    expect(() => parseActivity({ ...body, end: '2026-11-04T19:00:00-05:00' }, AT)).toThrow(/10 hours/)
    expect(() => parseActivity({ ...body, type: '' }, AT)).toThrow(/type/)
    expect(() => parseActivity({ ...body, distanceKm: 900 }, AT)).toThrow(/distance/)
    expect(() => parseActivity({ ...body, heartRates: '150\nfast' }, AT)).toThrow(/heartRates/)
  })
})

describe('activityKind', () => {
  it('reads Health’s workout names', () => {
    expect(activityKind('Running')).toBe('run')
    expect(activityKind('Outdoor Run')).toBe('run')
    expect(activityKind('Traditional Strength Training')).toBe('lifting')
    expect(activityKind('Functional Strength Training')).toBe('circuit')
    expect(activityKind('High Intensity Interval Training')).toBe('circuit')
    expect(activityKind('Cross Training')).toBe('circuit')
    expect(activityKind('Mixed Cardio')).toBe('circuit')
    expect(activityKind('Mixed Metabolic Cardio Training')).toBe('circuit')
    expect(activityKind('Walking')).toBe('other')
    expect(activityKind('Rowing')).toBe('other')
  })
})

/**
 * Week 3 (2 to 8 November 2026): Speed, Strength, Threshold, HYROX and the
 * Optional Easy run.
 */
const run = (start: string, extra: Partial<Activity> = {}): Activity => ({
  ...parseActivity({ ...body, start, end: start.replace(/T(\d\d)/, (_, h) => `T${String(Number(h) + 1).padStart(2, '0')}`) }, AT),
  ...extra,
})
const log = (sessionId: string, date: string, status: SessionLog['status'] = 'done'): SessionLog => ({
  id: `log-${sessionId}-${date}`,
  week: 3,
  sessionId,
  date: localDate(date),
  status,
  minutes: 45,
  rpe: 6,
  notes: null,
  resultSeconds: null,
  environment: null,
  distanceMeters: null,
  intervals: [],
  sets: [],
  stations: [],
  updatedAt: `${date}T20:00:00.000Z`,
})
const answer = (activityId: string, sessionId: string | null): ActivityAnswer => ({
  activityId,
  week: sessionId ? 3 : null,
  sessionId,
  updatedAt: '2026-11-04T21:00:00.000Z',
})

describe('matchActivities', () => {
  it('attaches a run to the one run Session logged that day', () => {
    const activity = run('2026-11-04T07:00:00-05:00')
    const [outcome] = matchActivities(program, [activity], [log('speed', '2026-11-04')], [])
    expect(outcome).toMatchObject({ state: 'attached', week: 3, sessionId: 'speed', by: 'coach' })
  })

  it('attaches by Session type: a lifting workout goes to Strength, not the run logged the same day', () => {
    const lifting = { ...run('2026-11-04T18:00:00-05:00'), workoutType: 'Traditional Strength Training', kind: 'lifting' as const }
    const [outcome] = matchActivities(program, [lifting], [log('speed', '2026-11-04'), log('strength', '2026-11-04')], [])
    expect(outcome).toMatchObject({ state: 'attached', sessionId: 'strength' })
  })

  it('with nothing logged that day, attaches to the one run Session still Planned', () => {
    const activity = run('2026-11-04T07:00:00-05:00')
    const logs = [log('speed', '2026-11-02'), log('easy', '2026-11-03')]
    expect(matchActivities(program, [activity], logs, [])[0]).toMatchObject({ state: 'attached', sessionId: 'threshold' })
  })

  it('attaches to a Session of another Week logged that day, done early or late', () => {
    const activity = run('2026-11-04T07:00:00-05:00')
    const early = { ...log('threshold', '2026-11-04'), week: 5 }
    expect(matchActivities(program, [activity], [early], [])[0]).toMatchObject({ state: 'attached', week: 5, sessionId: 'threshold' })
    const late = { ...log('speed', '2026-11-04'), week: 1 }
    expect(matchActivities(program, [activity], [late], [])[0]).toMatchObject({ state: 'attached', week: 1, sessionId: 'speed' })
  })

  it('attaches a workout from before the Program to the Week 1 Session logged early that day', () => {
    const activity = run('2026-10-14T07:00:00-04:00')
    const early = { ...log('speed', '2026-10-14'), week: 1 }
    expect(matchActivities(program, [activity], [early], [])[0]).toMatchObject({ state: 'attached', week: 1, sessionId: 'speed' })
    expect(matchActivities(program, [activity], [], [])[0].state).toBe('unmatched')
  })

  it('asks when more than one Session fits', () => {
    const activity = run('2026-11-04T07:00:00-05:00')
    const [outcome] = matchActivities(program, [activity], [], [])
    expect(outcome.state).toBe('ambiguous')
    expect(outcome.state === 'ambiguous' && outcome.candidates.map((c) => c.session.id)).toEqual(['speed', 'threshold', 'easy'])
  })

  it('asks between two run Sessions both logged that day', () => {
    const activity = run('2026-11-04T07:00:00-05:00')
    const [outcome] = matchActivities(program, [activity], [log('speed', '2026-11-04'), log('easy', '2026-11-04')], [])
    expect(outcome.state === 'ambiguous' && outcome.candidates.map((c) => c.session.id)).toEqual(['speed', 'easy'])
  })

  it('picks, of two run Sessions logged that day, the one whose Live session ran while the watch did', () => {
    const activity = run('2026-11-04T07:00:00-05:00')
    const live = { ...log('speed', '2026-11-04'), updatedAt: '2026-11-04T12:50:00.000Z' }
    const [outcome] = matchActivities(program, [activity], [live, log('easy', '2026-11-04')], [])
    expect(outcome).toMatchObject({ state: 'attached', sessionId: 'speed', by: 'coach' })
  })

  it('takes the athlete’s answer, and “none of these” leaves it unattached without asking again', () => {
    const activity = run('2026-11-04T07:00:00-05:00')
    expect(matchActivities(program, [activity], [], [answer(activity.id, 'easy')])[0]).toMatchObject({
      state: 'attached',
      sessionId: 'easy',
      by: 'athlete',
    })
    expect(matchActivities(program, [activity], [], [answer(activity.id, null)])[0].state).toBe('dismissed')
  })

  it('has no candidate for a walk, a run once every run Session is logged on other days, or a day outside the Program', () => {
    const walk = { ...run('2026-11-04T07:00:00-05:00'), workoutType: 'Walking', kind: 'other' as const }
    expect(matchActivities(program, [walk], [], [])[0].state).toBe('unmatched')
    const logs = [log('speed', '2026-11-02'), log('threshold', '2026-11-03'), log('easy', '2026-11-03')]
    expect(matchActivities(program, [run('2026-11-04T07:00:00-05:00')], logs, [])[0].state).toBe('unmatched')
    expect(matchActivities(program, [run('2026-09-01T07:00:00-04:00')], [], [])[0].state).toBe('unmatched')
  })

  it('never attaches two Activities to one Session: the earlier one claims it, the later one asks among the rest', () => {
    const morning = run('2026-11-04T07:00:00-05:00')
    const evening = run('2026-11-04T18:00:00-05:00')
    const outcomes = matchActivities(program, [evening, morning], [log('speed', '2026-11-04')], [])
    expect(outcomes.find((o) => o.activity.id === morning.id)).toMatchObject({ state: 'attached', sessionId: 'speed' })
    expect(outcomes.find((o) => o.activity.id === evening.id)?.state).toBe('ambiguous')
  })

  it('lets an answer claim its Session before the Coach matches the rest, which then asks', () => {
    const morning = run('2026-11-04T07:00:00-05:00')
    const evening = run('2026-11-04T18:00:00-05:00')
    const logs = [log('speed', '2026-11-04')]
    const outcomes = matchActivities(program, [morning, evening], logs, [answer(evening.id, 'speed')])
    expect(outcomes.find((o) => o.activity.id === evening.id)).toMatchObject({ state: 'attached', sessionId: 'speed' })
    expect(outcomes.find((o) => o.activity.id === morning.id)?.state).toBe('ambiguous')
  })

  it('doesn’t match to a Skipped Session', () => {
    const logs = [log('speed', '2026-11-04', 'skipped'), log('easy', '2026-11-03')]
    expect(matchActivities(program, [run('2026-11-04T07:00:00-05:00')], logs, [])[0]).toMatchObject({
      state: 'attached',
      sessionId: 'threshold',
    })
  })
})

describe('isTreadmill', () => {
  it('trusts the Shortcut’s flag, else the month’s Environment; only runs are on a treadmill', () => {
    const activity = run('2026-11-04T07:00:00-05:00')
    expect(isTreadmill({ ...activity, indoor: true }, () => 'outdoor')).toBe(true)
    expect(isTreadmill({ ...activity, indoor: false }, () => 'indoor')).toBe(false)
    expect(isTreadmill(activity, () => 'indoor')).toBe(true)
    expect(isTreadmill(activity, () => 'outdoor')).toBe(false)
    expect(isTreadmill({ ...activity, kind: 'lifting', indoor: true }, () => 'indoor')).toBe(false)
  })
})

describe('answers', () => {
  it('checks an answer and keeps the later edit of each', () => {
    const a = parseActivityAnswer({ activityId: '2026-11-04T12:12:00Z', week: 3, sessionId: 'easy', updatedAt: '2026-11-04T21:00:00.000Z' })
    const b = { ...a, sessionId: 'speed', updatedAt: '2026-11-04T22:00:00.000Z' }
    expect(mergeAnswers([b], [a])).toEqual([b])
    expect(answerFor([a], a.activityId)).toEqual(a)
    expect(() => parseActivityAnswer({ ...a, week: null })).toThrow(/together/)
    expect(() => parseActivityAnswer({ ...a, activityId: 'x' })).toThrow(/activityId/)
  })
})
