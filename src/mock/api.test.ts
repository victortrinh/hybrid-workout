import initSqlJs from 'sql.js'
import { beforeEach, describe, expect, it } from 'vitest'
import type { SessionLog, SyncState } from '../domain/log'
import { MOCK_SERVICE_TOKEN, mockApi } from './api'
import { d1 } from './d1'
import { openDatabase } from './database'

const SQL = await initSqlJs()

const log = (change: Partial<SessionLog> = {}): SessionLog => ({
  id: 'log-run-0001',
  week: 3,
  sessionId: 'run',
  date: '2026-11-25' as SessionLog['date'],
  status: 'done',
  minutes: 40,
  rpe: 7,
  notes: null,
  resultSeconds: null,
  environment: null,
  distanceMeters: null,
  recoveryPace: null,
  intervals: [{ block: 0, rep: 1, targetPace: 240, held: true, actualPace: null }],
  sets: [],
  stations: [],
  updatedAt: '2026-11-25T20:00:00.000Z',
  ...change,
})

describe('the Worker in the browser', () => {
  let api: ReturnType<typeof mockApi>
  beforeEach(() => {
    api = mockApi(d1(openDatabase(SQL)))
  })

  const sync = async (body: unknown) => {
    const response = await api(
      new Request('http://localhost/api/sync', { method: 'POST', body: JSON.stringify(body) }),
    )
    const answer = await response.json()
    expect(response.status, JSON.stringify(answer)).toBe(200)
    return answer as SyncState
  }
  const state = async () => (await (await api(new Request('http://localhost/api/state'))).json()) as SyncState

  it('keeps a synced Session log for /api/state', async () => {
    await sync({ sessionLogs: [log()] })
    const { sessionLogs } = await state()
    expect(sessionLogs).toEqual([log()])
  })

  it('takes a later edit and ignores an older replay, reps and all, as D1 does', async () => {
    await sync({ sessionLogs: [log()] })
    const later = log({
      rpe: 9,
      intervals: [{ block: 0, rep: 1, targetPace: 240, held: false, actualPace: 250 }],
      updatedAt: '2026-11-25T21:00:00.000Z',
    })
    await sync({ sessionLogs: [later] })
    await sync({ sessionLogs: [log()] })
    expect((await state()).sessionLogs).toEqual([later])
  })

  it('keeps by-feel speeds: a rep’s actual pace with no target, and the jogs’ recovery pace', () => {
    const byFeel = log({ recoveryPace: 600, intervals: [{ block: 4, rep: 1, targetPace: null, held: false, actualPace: 257 }] })
    return sync({ sessionLogs: [byFeel] }).then(async () => expect((await state()).sessionLogs).toEqual([byFeel]))
  })

  it('keeps the race’s finish time, past the hour', async () => {
    const race = log({ id: 'log-race-0001', week: 24, sessionId: 'race', date: '2027-04-22' as SessionLog['date'], minutes: 85, rpe: null, resultSeconds: 5047, intervals: [] })
    await sync({ sessionLogs: [race] })
    expect((await state()).sessionLogs).toEqual([race])
  })

  it('refuses a result time on any Session but the race, or past what it can take', async () => {
    const post = (sessionLogs: SessionLog[]) =>
      api(new Request('http://localhost/api/sync', { method: 'POST', body: JSON.stringify({ sessionLogs }) }))
    expect((await post([log({ resultSeconds: 1380 })])).status).toBe(400)
    expect((await post([log({ sessionId: 'compromised-run-test', week: 2, intervals: [], resultSeconds: 1380 })])).status).toBe(400)
    expect((await post([log({ week: 24, sessionId: 'race', intervals: [], resultSeconds: 600 })])).status).toBe(400)
  })

  it('keeps the Starting point, a later edit winning, and refuses an unbelievable one', async () => {
    expect((await state()).startingPoint).toBeNull()
    const point = { splitSeconds: 330, weights: { 'back-squat': 225 }, updatedAt: '2026-10-22T12:00:00.000Z' }
    expect((await sync({ startingPoint: point })).startingPoint).toEqual(point)
    const later = { splitSeconds: null, weights: { 'romanian-deadlift': 185 }, updatedAt: '2026-10-23T12:00:00.000Z' }
    await sync({ startingPoint: later })
    await sync({ startingPoint: point })
    expect((await state()).startingPoint).toEqual(later)
    const refused = await api(
      new Request('http://localhost/api/sync', {
        method: 'POST',
        body: JSON.stringify({ startingPoint: { ...point, splitSeconds: 60 } }),
      }),
    )
    expect(refused.status).toBe(400)
  })

  it('lets the Shortcut in with the mock service token, and nobody else', async () => {
    const night = { date: '2026-11-25', sleepMinutes: 420, hrvMs: 60, restingHeartRate: 50, source: 'Ring' }
    const post = (headers: Record<string, string>) =>
      api(new Request('http://localhost/api/recovery', { method: 'POST', headers, body: JSON.stringify(night) }))
    expect((await post({})).status).toBe(401)
    const response = await post({
      'CF-Access-Client-Id': MOCK_SERVICE_TOKEN.id,
      'CF-Access-Client-Secret': MOCK_SERVICE_TOKEN.secret,
    })
    expect(response.status).toBe(200)
    expect((await state()).recoveryNights?.map((n) => n.sleepMinutes)).toEqual([420])
  })

  it('exports what it holds', async () => {
    await sync({ sessionLogs: [log({ recoveryPace: 600 })] })
    const response = await api(new Request('http://localhost/api/export.json'))
    expect(response.headers.get('content-disposition')).toMatch(/attachment; filename="compromised-.*\.json"/)
    const { tables } = (await response.json()) as { tables: Record<string, unknown[]> }
    expect(tables.session_logs).toEqual([expect.objectContaining({ id: 'log-run-0001', recovery_pace: 600 })])
    expect(tables.interval_logs).toHaveLength(1)
    expect(tables.starting_point).toEqual([])
    const zip = await api(new Request('http://localhost/api/export.zip'))
    expect(zip.headers.get('content-type')).toBe('application/zip')
    const files = new TextDecoder().decode(await zip.arrayBuffer())
    expect(files).toMatch(/session_logs\.csvid,week,session_id,.*,recovery_pace\r\nlog-run-0001,.*,600\r\n/)
  })

  it('exports every table the migrations create, in the new schema: test splits as Station logs, the estimated split, the race finish', async () => {
    const test = log({
      id: 'log-crt-0001',
      week: 2,
      sessionId: 'compromised-run-test',
      date: '2026-11-18' as SessionLog['date'],
      minutes: 45,
      rpe: 9,
      environment: 'indoor',
      intervals: [],
      stations: [
        { round: 1, part: 'run', pounds: null, meters: 1000, reps: null, seconds: 300 },
        { round: 1, part: 'skierg', pounds: null, meters: 500, reps: null, seconds: 115 },
      ],
      updatedAt: '2026-11-18T20:00:00.000Z',
    })
    await sync({
      sessionLogs: [test],
      startingPoint: { splitSeconds: 307, weights: { 'back-squat': 225 }, updatedAt: '2026-11-08T20:00:00.000Z' },
    })
    const { tables } = (await (await api(new Request('http://localhost/api/export.json'))).json()) as {
      tables: Record<string, Record<string, unknown>[]>
    }
    const db = openDatabase(SQL)
    const created = db
      .exec("select name from sqlite_master where type = 'table' and name not like 'sqlite_%' and name != 'd1_migrations'")[0]
      .values.flat()
    expect(Object.keys(tables).sort()).toEqual([...created].sort())
    expect(Object.keys(tables.session_logs[0])).not.toContain('result_seconds')
    expect(tables.session_logs[0]).toMatchObject({ id: 'log-crt-0001', session_id: 'compromised-run-test', finish_seconds: null })
    expect(tables.station_logs).toEqual([
      expect.objectContaining({ session_log_id: 'log-crt-0001', round: 1, part: 'run', meters: 1000, seconds: 300 }),
      expect.objectContaining({ session_log_id: 'log-crt-0001', round: 1, part: 'skierg', meters: 500, seconds: 115 }),
    ])
    expect(Object.keys(tables.starting_point[0]).sort()).toEqual(
      ['back_squat_pounds', 'id', 'romanian_deadlift_pounds', 'split_seconds', 'updated_at'],
    )
    expect(tables.starting_point[0]).toMatchObject({ split_seconds: 307, back_squat_pounds: 225 })
  })
})
