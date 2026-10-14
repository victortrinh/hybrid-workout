import { mergeLogs, type SessionLog, type SyncState } from '../../domain/log'
import type { LocalStore } from './store'

/** What the server said to a batch of logs. */
export type SendResult =
  | { kind: 'taken'; state: SyncState }
  /** The server answered 400: these logs will never be taken as they are. */
  | { kind: 'refused' }
  /** Offline, timed out, signed out or a 5xx: try again later. */
  | { kind: 'unreachable' }

export type Send = (logs: SessionLog[]) => Promise<SendResult>

export interface SyncSnapshot {
  logs: SessionLog[]
  /** Edits saved on this device that the server hasn't taken yet. */
  pending: number
  /** Something the athlete should read: a refused log, or a store that won't open. */
  error: string | null
}

export interface Syncer {
  snapshot(): SyncSnapshot
  subscribe(listener: () => void): () => void
  /** Reads the device's logs, then syncs. */
  start(): Promise<void>
  /** Saves on the device at once, then tries the server. */
  save(log: SessionLog): Promise<void>
  /** Sends the outbox and takes the server's state. Safe to call at any time, as often as you like. */
  flush(): Promise<void>
}

/**
 * Local-first Session logs. Every write lands in the device store and its
 * outbox before anything else; the outbox flushes to the sync endpoint
 * whenever it's reachable. Conflicts resolve last-write-wins per log, here and
 * on the server, so replaying a batch is harmless.
 */
export function createSyncer(store: LocalStore, send: Send): Syncer {
  let logs: SessionLog[] = []
  let outbox = new Map<string, SessionLog>()
  let error: string | null = null
  let snapshot: SyncSnapshot = { logs, pending: 0, error }
  const listeners = new Set<() => void>()
  let flushing: Promise<void> | null = null
  let again = false

  function publish() {
    snapshot = { logs, pending: outbox.size, error }
    for (const listener of listeners) listener()
  }

  async function sendOnce() {
    const batch = [...outbox.values()]
    let result = await send(batch)
    let refused: SessionLog[] = []

    // One bad log mustn't hold the rest back: find it by sending them one at a time.
    if (result.kind === 'refused' && batch.length > 1) {
      const taken: SessionLog[] = []
      let state: SyncState | null = null
      for (const log of batch) {
        const single = await send([log])
        if (single.kind === 'unreachable') return
        if (single.kind === 'refused') refused.push(log)
        else {
          taken.push(log)
          state = single.state
        }
      }
      result = state ? { kind: 'taken', state } : { kind: 'refused' }
      batch.splice(0, batch.length, ...taken)
    } else if (result.kind === 'refused') {
      refused = batch
    }

    if (refused.length > 0) {
      const ids = new Set(refused.map((l) => l.id))
      logs = logs.filter((l) => !ids.has(l.id))
      for (const log of refused) if (outbox.get(log.id)?.updatedAt === log.updatedAt) outbox.delete(log.id)
      error =
        refused.length === 1
          ? 'The server refused a log saved on this phone. Log it again.'
          : `The server refused ${refused.length} logs saved on this phone. Log them again.`
      await store.drop(refused)
    }
    if (result.kind !== 'taken') return

    const merged = mergeLogs(logs, result.state.sessionLogs)
    for (const log of batch) if (outbox.get(log.id)?.updatedAt === log.updatedAt) outbox.delete(log.id)
    logs = merged
    await store.settle(merged, batch)
  }

  async function flush(): Promise<void> {
    if (flushing) {
      again = true
      return flushing
    }
    flushing = (async () => {
      try {
        do {
          again = false
          try {
            await sendOnce()
          } catch {
            // The device store failed mid-sync; the outbox is still in memory and goes next time.
          }
          publish()
        } while (again)
      } finally {
        flushing = null
      }
    })()
    return flushing
  }

  return {
    snapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    async start() {
      try {
        const stored = await store.load()
        logs = mergeLogs(logs, stored.logs)
        for (const log of stored.outbox) if (!outbox.has(log.id)) outbox.set(log.id, log)
      } catch {
        error = 'Couldn’t open this phone’s storage. Logs will sync but won’t survive a reload offline.'
      }
      publish()
      await flush()
    },
    async save(log) {
      logs = mergeLogs(logs, [log])
      outbox.set(log.id, log)
      error = null
      publish()
      try {
        await store.write(log)
      } catch {
        error = 'Couldn’t save that log on this phone. It syncs if you stay online; don’t reload until it has.'
        publish()
      }
      await flush()
    },
    flush,
  }
}
