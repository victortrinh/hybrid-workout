import { describe, expect, it } from 'vitest'
import { localDate } from '../../domain/calendar'
import { mergeLogs, type SessionLog } from '../../domain/log'
import { memoryStore } from './store'
import { createSyncer, type Send, type SendResult } from './syncer'

const log = (id: string, change: Partial<SessionLog> = {}): SessionLog => ({
  id: `log-${id}-0000`,
  week: 3,
  sessionId: 'speed',
  date: localDate('2026-11-04'),
  status: 'done',
  minutes: 40,
  rpe: 7,
  notes: null,
  updatedAt: '2026-11-04T20:00:00.000Z',
  ...change,
})

/** A server that holds logs last-write-wins, like the Worker, and can be cut off or made to refuse. */
interface FakeServer {
  logs: SessionLog[]
  online: boolean
  refuses: (log: SessionLog) => boolean
  send: Send
}

function fakeServer(held: SessionLog[] = []): FakeServer {
  const server: FakeServer = {
    logs: held,
    online: true,
    refuses: () => false,
    send: async (batch): Promise<SendResult> => {
      if (!server.online) return { kind: 'unreachable' }
      if (batch.some(server.refuses)) return { kind: 'refused' }
      server.logs = mergeLogs(server.logs, batch)
      return { kind: 'taken', state: { sessionLogs: server.logs, suggestionDecisions: [] } }
    },
  }
  return server
}

describe('the syncer', () => {
  it('shows a saved log at once and empties the outbox once the server takes it', async () => {
    const server = fakeServer()
    const store = memoryStore()
    const syncer = createSyncer(store, server.send)
    await syncer.start()

    const saving = syncer.save(log('a'))
    expect(syncer.snapshot()).toMatchObject({ logs: [log('a')], pending: 1 })
    await saving

    expect(syncer.snapshot()).toMatchObject({ logs: [log('a')], pending: 0, error: null })
    expect(server.logs).toEqual([log('a')])
    expect((await store.load()).outbox).toEqual([])
  })

  it('keeps logs saved offline on the device and sends them when back online', async () => {
    const server = fakeServer()
    const store = memoryStore()
    server.online = false
    const syncer = createSyncer(store, server.send)
    await syncer.start()

    await syncer.save(log('a'))
    await syncer.save(log('b', { sessionId: 'strength' }))
    expect(syncer.snapshot()).toMatchObject({ pending: 2, error: null })
    expect(server.logs).toEqual([])

    // A reload while still offline: the device still has both, still waiting.
    const reloaded = createSyncer(store, server.send)
    await reloaded.start()
    expect(reloaded.snapshot().logs).toHaveLength(2)
    expect(reloaded.snapshot().pending).toBe(2)

    server.online = true
    await reloaded.flush()
    expect(reloaded.snapshot().pending).toBe(0)
    expect(server.logs).toHaveLength(2)
  })

  it('takes logs written on another device', async () => {
    const elsewhere = log('x', { sessionId: 'hyrox' })
    const syncer = createSyncer(memoryStore(), fakeServer([elsewhere]).send)
    await syncer.start()
    expect(syncer.snapshot().logs).toEqual([elsewhere])
  })

  it('resolves conflicts last-write-wins per log', async () => {
    const theirs = log('a', { status: 'partial', updatedAt: '2026-11-05T09:00:00.000Z' })
    const server = fakeServer([theirs])
    server.online = false
    const syncer = createSyncer(memoryStore(), server.send)
    await syncer.start()

    // An older edit made offline loses to the server's later one…
    await syncer.save(log('a'))
    server.online = true
    await syncer.flush()
    expect(syncer.snapshot().logs).toEqual([theirs])
    expect(server.logs).toEqual([theirs])

    // …and a later one wins.
    const mine = log('a', { status: 'skipped', updatedAt: '2026-11-06T09:00:00.000Z' })
    await syncer.save(mine)
    expect(syncer.snapshot().logs).toEqual([mine])
    expect(server.logs).toEqual([mine])
  })

  it('keeps an edit made while its previous version was in flight', async () => {
    const server = fakeServer()
    let release: () => void = () => {}
    const gate = new Promise<void>((resolve) => (release = resolve))
    let hold = false
    const slow: Send = async (batch) => {
      if (hold) await gate
      return server.send(batch)
    }
    const syncer = createSyncer(memoryStore(), slow)
    await syncer.start()
    hold = true

    const first = syncer.save(log('a'))
    await Promise.resolve()
    const edit = log('a', { status: 'partial', updatedAt: '2026-11-04T21:00:00.000Z' })
    const second = syncer.save(edit)
    release()
    await Promise.all([first, second])

    expect(syncer.snapshot()).toMatchObject({ logs: [edit], pending: 0 })
    expect(server.logs).toEqual([edit])
  })

  it('drops only the log the server refuses, and says so', async () => {
    const server = fakeServer()
    server.online = false
    const store = memoryStore()
    const syncer = createSyncer(store, server.send)
    await syncer.start()
    await syncer.save(log('good'))
    await syncer.save(log('bad', { sessionId: 'yoga' }))

    server.online = true
    server.refuses = (l) => l.sessionId === 'yoga'
    await syncer.flush()

    expect(syncer.snapshot()).toMatchObject({ logs: [log('good')], pending: 0 })
    expect(syncer.snapshot().error).toMatch(/refused a log/)
    expect(server.logs).toEqual([log('good')])
    expect(await store.load()).toEqual({ logs: [log('good')], outbox: [] })
  })

  it('says so when the device store won’t open', async () => {
    const broken = { ...memoryStore(), load: () => Promise.reject(new Error('blocked')) }
    const syncer = createSyncer(broken, fakeServer().send)
    await syncer.start()
    expect(syncer.snapshot().error).toMatch(/storage/)
  })
})
