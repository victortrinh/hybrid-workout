import { useCallback, useEffect, useState, useSyncExternalStore } from 'react'
import type { SessionLog } from '../domain/log'
import { openIndexedDbStore } from './sync/store'
import { createSyncer, type Send, type ServerTrouble, type Syncer } from './sync/syncer'

export interface SessionLogs {
  logs: SessionLog[]
  /** Saves on this device at once; the server hears of it when it can be reached. */
  save: (log: SessionLog) => void
  /** Edits saved here that the server hasn't taken yet. */
  pending: number
  /** Something went wrong that the athlete should read. */
  error: string | null
  /** The server is failing, or Cloudflare Access wants a sign-in: nothing syncs until it's sorted. */
  server: ServerTrouble | null
}

/** How long a sync may take before the gym's one bar of signal counts as none. */
const TIMEOUT_MS = 10_000
/** While edits wait, how often to try again even without an `online` event. */
const RETRY_MS = 30_000

/**
 * Session logs, local-first: read from the device's IndexedDB, written there
 * before anything else, and synced with the server whenever it's reachable
 * (on start, after a save, when the phone comes back online or to the
 * foreground, and every 30 seconds while edits wait).
 */
export function useSessionLogs(): SessionLogs {
  const [syncer] = useState(() =>
    createSyncer(
      {
        load: async () => (await device()).load(),
        write: async (log) => (await device()).write(log),
        settle: async (logs, taken) => (await device()).settle(logs, taken),
        drop: async (refused) => (await device()).drop(refused),
      },
      send,
    ),
  )
  const snapshot = useSyncExternalStore(syncer.subscribe, syncer.snapshot)
  useSync(syncer, snapshot.pending > 0)

  const save = useCallback((log: SessionLog) => void syncer.save(log), [syncer])
  return { logs: snapshot.logs, save, pending: snapshot.pending, error: snapshot.error, server: snapshot.server }
}

function useSync(syncer: Syncer, waiting: boolean) {
  useEffect(() => {
    void syncer.start()
    const flush = () => void syncer.flush()
    const visible = () => document.visibilityState === 'visible' && flush()
    window.addEventListener('online', flush)
    document.addEventListener('visibilitychange', visible)
    return () => {
      window.removeEventListener('online', flush)
      document.removeEventListener('visibilitychange', visible)
    }
  }, [syncer])

  useEffect(() => {
    if (!waiting) return
    const timer = window.setInterval(() => void syncer.flush(), RETRY_MS)
    return () => window.clearInterval(timer)
  }, [syncer, waiting])
}

/** One IndexedDB connection per page. Where the browser blocks it, every call fails and the syncer says so. */
let opened: ReturnType<typeof openIndexedDbStore> | null = null
const device = () => (opened ??= openIndexedDbStore())

const send: Send = async (sessionLogs) => {
  try {
    const response = await fetch('/api/sync', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionLogs }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
      // An expired Cloudflare Access session answers with a redirect to its
      // login page. Followed, it fails like being offline; seen, it can be said.
      redirect: 'manual',
    })
    // Only a 400 means the logs themselves are wrong. Anything else is worth
    // trying again later, but a sign-in or a failing server is said on Today.
    if (response.status === 400) return { kind: 'refused' }
    if (response.type === 'opaqueredirect' || response.status === 401 || response.status === 403) {
      return { kind: 'unreachable', server: 'signed-out' }
    }
    if (response.status >= 500) return { kind: 'unreachable', server: 'failing' }
    if (!response.ok) return { kind: 'unreachable' }
    return { kind: 'taken', state: await response.json() }
  } catch {
    return { kind: 'unreachable' }
  }
}
