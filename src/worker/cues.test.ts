import { describe, expect, it } from 'vitest'
import app from './index'

/** The cue timer's Durable Object, stood in for: records what it's asked. */
function timer({ fails = false } = {}) {
  const calls: [string, unknown?][] = []
  const call = (name: string) => async (arg?: unknown) => {
    if (fails) throw new Error('Worker "compromised-cues" not found')
    calls.push(arg === undefined ? [name] : [name, arg])
    return name === 'publicKey' ? 'BKey' : name === 'subscribed' ? true : undefined
  }
  const stub = Object.fromEntries(['publicKey', 'subscribed', 'subscribe', 'unsubscribe', 'schedule'].map((n) => [n, call(n)]))
  const CUES = { idFromName: (name: string) => name, get: () => stub }
  return { calls, env: { CUES } as unknown as Env }
}

const request = (env: Env, method: string, path: string, body?: unknown) =>
  app.fetch(
    new Request(`https://compromised.test/api${path}`, {
      method,
      headers: { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    env,
  )

const SUBSCRIPTION = { endpoint: 'https://web.push.apple.com/QH4', keys: { p256dh: 'BNc-x_1', auth: 'k9_Q' } }

describe('/api/cues', () => {
  it('gives the key to subscribe with', async () => {
    const { env } = timer()
    const response = await request(env, 'GET', '/cues')
    expect(await response.json()).toEqual({ key: 'BKey', subscribed: true })
  })

  it('keeps the subscription, and drops it', async () => {
    const { env, calls } = timer()
    expect((await request(env, 'PUT', '/cues/subscription', SUBSCRIPTION)).status).toBe(204)
    expect((await request(env, 'DELETE', '/cues/subscription')).status).toBe(204)
    expect(calls).toEqual([['subscribe', SUBSCRIPTION], ['unsubscribe']])
  })

  it('refuses a subscription that isn’t one', async () => {
    const { env, calls } = timer()
    for (const body of [{ endpoint: 'http://web.push.apple.com/x', keys: SUBSCRIPTION.keys }, { endpoint: SUBSCRIPTION.endpoint }]) {
      expect((await request(env, 'PUT', '/cues/subscription', body)).status).toBe(400)
    }
    expect(calls).toEqual([])
  })

  it('hands the timer the cues in time order, and refuses a bad list', async () => {
    const { env, calls } = timer()
    const cues = [
      { at: 2000, title: 'Rep 2 of 5', body: '' },
      { at: 1000, title: 'Jog', body: 'Breathe.' },
    ]
    expect((await request(env, 'PUT', '/cues/schedule', { cues })).status).toBe(204)
    expect(calls).toEqual([['schedule', [cues[1], cues[0]]]])
    expect((await request(env, 'PUT', '/cues/schedule', { cues: [{ at: 'soon', title: 'Jog', body: '' }] })).status).toBe(400)
    expect((await request(env, 'PUT', '/cues/schedule', {})).status).toBe(400)
  })

  it('answers 503 with no timer bound, as in mock mode, or none reachable', async () => {
    expect((await request({} as Env, 'GET', '/cues')).status).toBe(503)
    const { env } = timer({ fails: true })
    expect((await request(env, 'GET', '/cues')).status).toBe(503)
    expect((await request(env, 'PUT', '/cues/schedule', { cues: [] })).status).toBe(503)
  })
})
