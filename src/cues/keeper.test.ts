import { describe, expect, it } from 'vitest'
import type { Cue } from '../domain/cues'
import { CueKeeper, type KeeperStorage } from './keeper'
import type { PushResult, Subscription } from './push'

const PHONE: Subscription = { endpoint: 'https://web.push.apple.com/abc', keys: { p256dh: 'p', auth: 'a' } }
const T = Date.UTC(2026, 10, 3, 11)
const cue = (seconds: number, title: string): Cue => ({ at: T + seconds * 1000, title, body: '' })

/** Durable Object storage in memory, with its one alarm. */
function memory() {
  const values = new Map<string, unknown>()
  const state = { alarm: null as number | null }
  const storage: KeeperStorage = {
    get: async <V>(key: string) => values.get(key) as V | undefined,
    put: async (key, value) => void values.set(key, value),
    delete: async (key) => values.delete(key),
    setAlarm: async (at) => void (state.alarm = at),
    deleteAlarm: async () => void (state.alarm = null),
  }
  return { storage, values, state }
}

function keeper(answer: PushResult = 'sent') {
  const sent: string[] = []
  const store = memory()
  const k = new CueKeeper(store.storage, async (_, c) => {
    sent.push(c.title)
    return answer
  })
  return { k, sent, ...store }
}

describe('CueKeeper', () => {
  it('sets the alarm on the first cue still ahead, and sends each when it fires', async () => {
    const { k, sent, state } = keeper()
    await k.subscribe(PHONE)
    await k.schedule([cue(-5, 'Gone by'), cue(60, 'Jog'), cue(150, 'Rep 2 of 5')], T)
    expect(state.alarm).toBe(T + 60_000)
    await k.alarm(T + 60_000)
    expect(sent).toEqual(['Jog'])
    expect(state.alarm).toBe(T + 150_000)
    await k.alarm(T + 150_000)
    expect(sent).toEqual(['Jog', 'Rep 2 of 5'])
    expect(state.alarm).toBeNull()
  })

  it('sends only the latest of several due at once, and none that is a minute stale', async () => {
    const { k, sent } = keeper()
    await k.subscribe(PHONE)
    await k.schedule([cue(10, 'Jog'), cue(20, 'Rep 2 of 5'), cue(500, 'Cooldown')], T)
    await k.alarm(T + 25_000)
    expect(sent).toEqual(['Rep 2 of 5'])

    await k.schedule([cue(10, 'Jog')], T)
    await k.alarm(T + 75_000)
    expect(sent).toEqual(['Rep 2 of 5'])
  })

  it('replaces the whole list on every schedule, and clears it on none', async () => {
    const { k, sent, state } = keeper()
    await k.subscribe(PHONE)
    await k.schedule([cue(10, 'Jog')], T)
    await k.schedule([cue(30, 'Rep 2 of 5')], T)
    expect(state.alarm).toBe(T + 30_000)
    await k.schedule([], T)
    expect(state.alarm).toBeNull()
    await k.alarm(T + 30_000)
    expect(sent).toEqual([])
  })

  it('keeps time without sending when nothing is subscribed', async () => {
    const { k, sent, state } = keeper()
    await k.schedule([cue(10, 'Jog'), cue(20, 'Rep 2 of 5')], T)
    await k.alarm(T + 10_000)
    expect(sent).toEqual([])
    expect(state.alarm).toBe(T + 20_000)
  })

  it('forgets a subscription the push service says is gone, and its cues', async () => {
    const { k, state } = keeper('gone')
    await k.subscribe(PHONE)
    await k.schedule([cue(10, 'Jog'), cue(20, 'Rep 2 of 5')], T)
    await k.alarm(T + 10_000)
    expect(await k.subscribed()).toBe(false)
    expect(state.alarm).toBeNull()
  })

  it('unsubscribe drops the subscription and every cue', async () => {
    const { k, values, state } = keeper()
    await k.subscribe(PHONE)
    await k.schedule([cue(10, 'Jog')], T)
    await k.unsubscribe()
    expect(await k.subscribed()).toBe(false)
    expect(values.has('cues')).toBe(false)
    expect(state.alarm).toBeNull()
  })
})
