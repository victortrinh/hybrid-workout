import initSqlJs from 'sql.js'
import { beforeEach, describe, expect, it } from 'vitest'
import { localDate } from '../domain/calendar'
import type { Activity } from '../domain/activity'
import type { RecoveryNight } from '../domain/recovery'
import { mockApi } from './api'
import { d1 } from './d1'
import { openDatabase } from './database'
import { SLOW_MS, throughNetwork } from './network'
import { DEFAULT_NIGHT, DEFAULT_WORKOUT, sendNight, sendWorkout } from './shortcut'

const SQL = await initSqlJs()
const TODAY = localDate('2026-11-04')

let api: ReturnType<typeof mockApi>
beforeEach(() => {
  api = mockApi(d1(openDatabase(SQL)))
})

const state = async () =>
  (await (await api(new Request('http://localhost/api/state'))).json()) as {
    recoveryNights: RecoveryNight[]
    activities: Activity[]
  }

describe('the network control', () => {
  const request = () => new Request('http://localhost/api/state')

  it('passes requests through when Online', async () => {
    expect((await throughNetwork('online', request(), api)).status).toBe(200)
  })

  it('fails every request with a network error when Offline', async () => {
    const response = await throughNetwork('offline', request(), api)
    expect(response.type).toBe('error')
  })

  it('answers 500 on a Server error', async () => {
    expect((await throughNetwork('server-error', request(), api)).status).toBe(500)
  })

  it('waits 3 seconds before each answer when Slow', async () => {
    const waited: number[] = []
    const response = await throughNetwork('slow', request(), api, async (ms) => void waited.push(ms))
    expect(waited).toEqual([SLOW_MS])
    expect(SLOW_MS).toBe(3_000)
    expect(response.status).toBe(200)
  })
})

describe('the Shortcut sends', () => {
  it('send the default night for today, short and low, with a normal week before it', async () => {
    const outcome = await sendNight(api, TODAY, DEFAULT_NIGHT)
    expect(outcome.ok, outcome.message).toBe(true)
    const nights = (await state()).recoveryNights
    expect(nights.map((n) => n.date)).toEqual([
      '2026-10-28',
      '2026-10-29',
      '2026-10-30',
      '2026-10-31',
      '2026-11-01',
      '2026-11-02',
      '2026-11-03',
      '2026-11-04',
    ])
    expect(nights.at(-1)).toMatchObject({ sleepMinutes: 320, hrvMs: 38 })
  })

  it('leave the nights already there alone', async () => {
    await sendNight(api, TODAY, { ...DEFAULT_NIGHT, baseline: false })
    await sendNight(api, localDate('2026-11-02'), { ...DEFAULT_NIGHT, sleepMinutes: 500, baseline: false })
    const outcome = await sendNight(api, TODAY, { ...DEFAULT_NIGHT, sleepMinutes: 300 })
    expect(outcome.message).toContain('6 normal nights')
    const nights = (await state()).recoveryNights
    expect(nights.find((n) => n.date === '2026-11-02')?.sleepMinutes).toBe(500)
    expect(nights.find((n) => n.date === '2026-11-04')?.sleepMinutes).toBe(300)
  })

  it('send the default workout on today, with its samples', async () => {
    const outcome = await sendWorkout(api, TODAY, DEFAULT_WORKOUT)
    expect(outcome.ok, outcome.message).toBe(true)
    expect((await state()).activities).toEqual([
      expect.objectContaining({
        id: '2026-11-04T12:00:00Z',
        date: TODAY,
        workoutType: 'Running',
        minutes: 45,
        distanceMeters: 8000,
        averageHeartRate: 150,
        maxHeartRate: 155,
      }),
    ])
  })

  it('say why the route refused one', async () => {
    const outcome = await sendWorkout(api, TODAY, { ...DEFAULT_WORKOUT, minutes: 0.1 })
    expect(outcome).toEqual({ ok: false, message: expect.stringContaining('(400): A workout lasts at least a minute') })
  })

  it('go through routes that still refuse a send without the service token', async () => {
    const post = (path: string, body: unknown) =>
      api(new Request(`http://localhost${path}`, { method: 'POST', body: JSON.stringify(body) }))
    expect((await post('/api/recovery', { date: TODAY, sleepMinutes: 320, source: 'Mock ring' })).status).toBe(401)
    expect((await post('/api/activities', { type: 'Running', start: '2026-11-04T12:00:00Z', end: '2026-11-04T12:45:00Z' })).status).toBe(401)
    const { recoveryNights, activities } = await state()
    expect(recoveryNights).toEqual([])
    expect(activities).toEqual([])
  })
})
