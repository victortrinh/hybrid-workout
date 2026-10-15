import initSqlJs from 'sql.js'
import { beforeEach, describe, expect, it } from 'vitest'
import type { SessionLog, SyncState } from '../domain/log'
import { MOCK_SERVICE_TOKEN, mockApi } from './api'
import { d1 } from './d1'
import { openDatabase } from './database'

const SQL = await initSqlJs()

const log = (change: Partial<SessionLog> = {}): SessionLog => ({
  id: 'log-speed-0001',
  week: 3,
  sessionId: 'speed',
  date: '2026-11-04' as SessionLog['date'],
  status: 'done',
  minutes: 40,
  rpe: 7,
  notes: null,
  resultSeconds: null,
  environment: null,
  distanceMeters: null,
  intervals: [{ block: 0, rep: 1, targetPace: 240, held: true, actualPace: null }],
  sets: [],
  stations: [],
  updatedAt: '2026-11-04T20:00:00.000Z',
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
      updatedAt: '2026-11-04T21:00:00.000Z',
    })
    await sync({ sessionLogs: [later] })
    await sync({ sessionLogs: [log()] })
    expect((await state()).sessionLogs).toEqual([later])
  })

  it('keeps the Starting point, a later edit winning, and refuses an unbelievable one', async () => {
    expect((await state()).startingPoint).toBeNull()
    const point = { fiveKSeconds: 1260, weights: { 'back-squat': 225 }, updatedAt: '2026-10-15T12:00:00.000Z' }
    expect((await sync({ startingPoint: point })).startingPoint).toEqual(point)
    const later = { fiveKSeconds: null, weights: { 'romanian-deadlift': 185 }, updatedAt: '2026-10-16T12:00:00.000Z' }
    await sync({ startingPoint: later })
    await sync({ startingPoint: point })
    expect((await state()).startingPoint).toEqual(later)
    const refused = await api(
      new Request('http://localhost/api/sync', {
        method: 'POST',
        body: JSON.stringify({ startingPoint: { ...point, fiveKSeconds: 60 } }),
      }),
    )
    expect(refused.status).toBe(400)
  })

  it('lets the Shortcut in with the mock service token, and nobody else', async () => {
    const night = { date: '2026-11-04', sleepMinutes: 420, hrvMs: 60, restingHeartRate: 50, source: 'Ring' }
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
    await sync({ sessionLogs: [log()] })
    const response = await api(new Request('http://localhost/api/export.json'))
    expect(response.headers.get('content-disposition')).toMatch(/attachment; filename="compromised-.*\.json"/)
    const { tables } = (await response.json()) as { tables: Record<string, unknown[]> }
    expect(tables.session_logs).toHaveLength(1)
    expect(tables.interval_logs).toHaveLength(1)
    expect(tables.starting_point).toEqual([])
    const zip = await api(new Request('http://localhost/api/export.zip'))
    expect(zip.headers.get('content-type')).toBe('application/zip')
  })
})
