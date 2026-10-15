import initSqlJs from 'sql.js'
import { describe, expect, it } from 'vitest'
import { daysBetween, isoWeekday } from '../../domain/calendar'
import { coach, findWeek, type CoachDay } from '../../domain/coach'
import { parseLiveSession, isLifts } from '../../domain/lifts'
import type { SyncState } from '../../domain/log'
import { program } from '../../domain/program/program'
import { parseSettings } from '../../domain/settings'
import { mockApi } from '../api'
import { d1 } from '../d1'
import { openDatabase } from '../database'
import { chooseScenario } from './choose'
import { DEFAULT_SCENARIO, findScenario, SCENARIOS, type Scenario } from './index'
import { deviceStorage, loadScenario } from './load'

const SQL = await initSqlJs()

/** The scenario loaded into a fresh in-browser app, as /api/state answers it. */
async function loaded(scenario: Scenario): Promise<SyncState> {
  const api = mockApi(d1(openDatabase(SQL)))
  await loadScenario(api, scenario)
  return (await (await api(new Request('http://localhost/api/state'))).json()) as SyncState
}

/** What the Coach makes of the scenario on its day. */
async function day(name: string): Promise<CoachDay & { state: SyncState; scenario: Scenario }> {
  const scenario = findScenario(name)!
  const state = await loaded(scenario)
  const coached = coach({
    program,
    today: scenario.today,
    logs: state.sessionLogs,
    decisions: state.suggestionDecisions,
    painReports: state.painReports,
    recoveryNights: state.recoveryNights,
    activities: state.activities,
    activityAnswers: state.activityAnswers,
    startingPoint: state.startingPoint,
    equipment: parseSettings(scenario.device.settings).equipment,
  })
  return { ...coached, state, scenario }
}

const byId = <T extends { id: string }>(rows: T[]) => [...rows].sort((a, b) => a.id.localeCompare(b.id))

describe('scenarios', () => {
  it('are the thirteen the specs list, each named once, with the default among them', () => {
    expect(SCENARIOS.map((s) => s.name)).toEqual([
      'before-program',
      'first-launch',
      'week1-start',
      'estimates',
      'after-baseline',
      'midweek-mixed',
      'rollover',
      'deload',
      'activities-pending',
      'hyrox-build',
      'dense-history',
      'race-week',
      'after-race',
    ])
    expect(findScenario(DEFAULT_SCENARIO)).not.toBeNull()
  })

  for (const scenario of SCENARIOS) {
    it(`${scenario.name}: loads through the Worker's routes, and /api/state returns all of it`, async () => {
      const state = await loaded(scenario)
      const { server } = scenario
      expect(byId(state.sessionLogs)).toEqual(byId(server.sessionLogs))
      expect(byId(state.suggestionDecisions)).toEqual(byId(server.suggestionDecisions))
      expect(byId(state.painReports)).toEqual(byId(server.painReports))
      expect(state.activityAnswers ?? []).toEqual(server.activityAnswers)
      expect(state.startingPoint ?? null).toEqual(server.startingPoint)
      expect(
        (state.recoveryNights ?? []).map(({ date, sleepMinutes, hrvMs, restingHeartRate, source }) => ({
          date,
          sleepMinutes,
          hrvMs,
          restingHeartRate,
          source,
        })),
      ).toEqual(expect.arrayContaining(server.recoveryNights))
      expect(state.recoveryNights ?? []).toHaveLength(server.recoveryNights.length)
      expect((state.activities ?? []).map((a) => a.id).sort()).toEqual(server.activities.map((a) => a.start).sort())
    })

    it(`${scenario.name}: logs nothing after its day`, () => {
      for (const log of scenario.server.sessionLogs) expect(log.date <= scenario.today, log.id).toBe(true)
    })
  }
})

describe('each scenario falls where its name says', () => {
  it('before-program: five days before Week 1, nothing logged', async () => {
    const d = await day('before-program')
    expect(d.today).toBe('2026-10-14')
    expect(d.position).toEqual({ kind: 'before-start', startsOn: '2026-10-19', daysToStart: 5 })
    expect(d.state.sessionLogs).toEqual([])
    expect(d.bucket.every((b) => b.state === 'planned')).toBe(true)
  })

  it('week1-start: the Monday of Week 1, every run RPE only', async () => {
    const d = await day('week1-start')
    expect(d.position).toMatchObject({ kind: 'in-week', week: 1, phase: 'foundation', daysLeft: 7 })
    expect(d.paces).toBeNull()
    expect(d.upNext).not.toBeNull()
  })

  it('first-launch: no Starting point yet, so the screen shows; every run RPE only', async () => {
    const d = await day('first-launch')
    expect(d.position.kind).toBe('before-start')
    expect(d.state.startingPoint).toBeNull()
    expect(d.paces).toBeNull()
  })

  it('estimates: Week 1 with estimated paces from 21:00 and calibrations starting from the estimates', async () => {
    const d = await day('estimates')
    expect(d.position).toMatchObject({ kind: 'in-week', week: 1 })
    expect(d.fiveKTest).toBeNull()
    expect(d.paces).toMatchObject({ fromSeconds: 21 * 60, estimate: true })
    expect(d.estimatedWeights).toEqual({ 'back-squat': 225, 'romanian-deadlift': 185 })
  })

  it('every other scenario: the Starting point skipped, so it behaves as before', async () => {
    for (const s of SCENARIOS.filter((s) => !['first-launch', 'estimates'].includes(s.name))) {
      expect(s.server.startingPoint, s.name).toMatchObject({ fiveKSeconds: null, weights: {} })
    }
  })

  it('after-baseline: Week 2 with Training paces from a 23:00 test, Indoor and Outdoor, in mph', async () => {
    const d = await day('after-baseline')
    expect(d.position).toMatchObject({ kind: 'in-week', week: 2 })
    expect(d.paces?.fromSeconds).toBe(23 * 60)
    expect(parseSettings(d.scenario.device.settings).environmentByMonth[9]).toBe('outdoor')
    expect(d.scenario.device.environment).toEqual({ '2/threshold': 'indoor' })
    expect(parseSettings(d.scenario.device.settings).unit).toBe('mph')
  })

  it('midweek-mixed: Thursday of Week 5 with every Session status and Hard sessions back to back', async () => {
    const d = await day('midweek-mixed')
    expect(d.position).toMatchObject({ kind: 'in-week', week: 5 })
    expect(isoWeekday(d.today)).toBe(4)
    expect(new Set(d.bucket.map((b) => b.state))).toEqual(new Set(['done', 'partial', 'skipped', 'swapped', 'next']))
    expect(d.upNext?.key).toBe(true)
    const hard = d.state.sessionLogs.filter((l) => l.week === 5 && ['done', 'partial'].includes(l.status))
    expect(hard.map((l) => l.date).sort()).toEqual(['2026-11-16', '2026-11-17'])
  })

  it('rollover: the Monday after a Week with misses, its Key session carried and Up next, Suggestions open', async () => {
    const d = await day('rollover')
    expect(d.position).toMatchObject({ kind: 'in-week', week: 7, daysLeft: 7 })
    expect(d.bucket[0]).toMatchObject({ week: 6, state: 'next', carriedUntil: '2026-12-02' })
    expect(d.bucket[0].session.key).toBe(true)
    const open = d.suggestions.filter((s) => s.decision === 'open').map((s) => s.kind)
    expect(open).toEqual(expect.arrayContaining(['re-entry', 'working-weight']))
    const end = (week: number) => findWeek(program, week)!.startDate
    expect(d.state.sessionLogs.some((l) => daysBetween(end(l.week + 1), l.date) >= 0)).toBe(true)
    expect(d.state.sessionLogs.some((l) => daysBetween(l.date, end(l.week)) > 0)).toBe(true)
  })

  it('rollover: the lift increases wait out the lighter Week once it is accepted, and are offered when full volume is kept', async () => {
    const d = await day('rollover')
    const lifts = d.suggestions.filter((s) => s.kind === 'working-weight' && s.decision === 'open').map((s) => s.id)
    expect(lifts.length).toBeGreaterThan(1)
    const decided = (decision: 'accepted' | 'kept') =>
      coach({
        program,
        today: d.today,
        logs: d.state.sessionLogs,
        decisions: [
          ...d.state.suggestionDecisions,
          { id: 're-entry-w7', decision, date: d.today, updatedAt: '2026-11-30T12:00:00.000Z' },
        ],
      })
    const lighter = decided('accepted')
    expect(lighter.suggestions.filter((s) => s.kind === 'working-weight')).toEqual([])
    expect(lighter.heldIncreases.map((h) => h.suggestion.id)).toEqual(lifts)
    // Week 8 is a Deload week: they land after it, on Week 9's Monday.
    expect(new Set(lighter.heldIncreases.map((h) => h.landsOn))).toEqual(new Set(['2026-12-14']))
    const full = decided('kept')
    expect(full.suggestions.filter((s) => s.kind === 'working-weight').map((s) => s.id)).toEqual(lifts)
    expect(full.heldIncreases).toEqual([])
  })

  it('deload: in a Deload week, a Strength session left running at scaled loads', async () => {
    const d = await day('deload')
    expect(d.week?.deload).toBe(true)
    expect(d.workingWeights['back-squat']).toBeGreaterThan(0)
    const storage = deviceStorage(d.scenario, Date.parse('2026-12-09T23:20:00Z'))
    const live = parseLiveSession(JSON.parse(storage['compromised:live']))
    expect(live && isLifts(live) && live.week).toBe(8)
    if (!live || !isLifts(live)) return
    expect(live.sets[0].filter((s) => s.done)).toHaveLength(2)
    expect(live.sets[0][0].pounds).toBeLessThan(d.workingWeights[live.exercises[0].lift!]!)
  })

  it('activities-pending: mid-Program, two watch workouts asking which Session they were', async () => {
    const d = await day('activities-pending')
    expect(d.position).toMatchObject({ kind: 'in-week', week: 11 })
    expect(d.activityQuestions.map((q) => q.activity.workoutType)).toEqual(['Running', 'Functional Strength Training'])
  })

  it('hyrox-build: the HYROX build, with Working weights, Station logs, pain and low Readiness', async () => {
    const d = await day('hyrox-build')
    expect(d.position).toMatchObject({ kind: 'in-week', week: 19, phase: 'hyrox-build' })
    expect(Object.keys(d.workingWeights).length).toBeGreaterThanOrEqual(3)
    expect(d.state.sessionLogs.filter((l) => l.stations.length > 0).length).toBeGreaterThan(10)
    expect(d.pain?.level).toBe('ease')
    expect(d.recovery).toMatchObject({ shortSleep: true, easyDay: true })
    expect(d.suggestions.map((s) => s.kind)).toEqual(expect.arrayContaining(['pain', 'recovery']))
  })

  it('dense-history: Week 20, almost every Session of nineteen Weeks logged', async () => {
    const d = await day('dense-history')
    expect(d.position).toMatchObject({ kind: 'in-week', week: 20 })
    const required = program.phases
      .flatMap((p) => p.weeks)
      .filter((w) => w.number < 20)
      .flatMap((w) => w.sessions.filter((s) => !s.optional))
    const trained = d.state.sessionLogs.filter((l) => l.week < 20 && ['done', 'partial'].includes(l.status))
    expect(trained.length / required.length).toBeGreaterThan(0.95)
    expect(d.state.sessionLogs.filter((l) => l.resultSeconds !== null)).toHaveLength(3)
  })

  it('race-week: Race week, the day before Race day', async () => {
    const d = await day('race-week')
    expect(d.position).toMatchObject({ kind: 'in-week', week: 27 })
    expect(d.week?.race).toBe(true)
    expect(d.daysToRace).toBe(1)
  })

  it('after-race: 22 April 2027, the day after Race day, the race logged', async () => {
    const d = await day('after-race')
    expect(d.today).toBe('2027-04-22')
    expect(d.daysToRace).toBe(-1)
    expect(d.upNext).toBeNull()
    expect(d.state.sessionLogs.find((l) => l.sessionId === 'race')).toMatchObject({ status: 'done', date: '2027-04-21' })
  })
})

describe('chooseScenario', () => {
  it('loads a named scenario fresh, even the one already loaded', () => {
    expect(chooseScenario('deload', null)).toEqual({ name: 'deload', unknown: null, fresh: true })
    expect(chooseScenario('deload', { name: 'deload', unknown: null })).toEqual({ name: 'deload', unknown: null, fresh: true })
  })

  it('falls back to the default for a name it doesn’t know, and says which', () => {
    expect(chooseScenario('race-day', { name: 'deload', unknown: null })).toEqual({
      name: DEFAULT_SCENARIO,
      unknown: 'race-day',
      fresh: true,
    })
  })

  it('carries on with the tab’s scenario on a reload, and starts the default in a new tab', () => {
    expect(chooseScenario(null, { name: 'rollover', unknown: null })).toEqual({ name: 'rollover', unknown: null, fresh: false })
    expect(chooseScenario(null, null)).toEqual({ name: DEFAULT_SCENARIO, unknown: null, fresh: true })
    expect(chooseScenario(null, { name: 'gone', unknown: null })).toEqual({ name: DEFAULT_SCENARIO, unknown: null, fresh: true })
  })
})

describe('deviceStorage', () => {
  it('writes whole settings, and only what the scenario sets', () => {
    const storage = deviceStorage(findScenario('after-baseline')!, 0)
    expect(JSON.parse(storage['compromised:settings'])).toEqual(parseSettings({ unit: 'mph' }))
    expect(JSON.parse(storage['compromised:environment'])).toEqual({ '2/threshold': 'indoor' })
    expect(storage['compromised:live']).toBeUndefined()
    expect(Object.keys(deviceStorage(findScenario('before-program')!, 0))).toEqual(['compromised:settings'])
  })
})
