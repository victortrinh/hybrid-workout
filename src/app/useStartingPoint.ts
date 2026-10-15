import { useCallback, useEffect, useState } from 'react'
import type { SyncState } from '../domain/log'
import { laterStartingPoint, parseStartingPoint, type StartingPoint } from '../domain/startingPoint'
import { editedAt } from './useDecisions'

export interface StartingPointState {
  point: StartingPoint | null
  /**
   * Whether the athlete has answered the Starting point, as far as this
   * device knows: null while the first launch waits on the server, which may
   * hold an answer from another device.
   */
  answered: boolean | null
  /** Counts at once on this device; the server hears of it when it can be reached. */
  save: (estimates: Omit<StartingPoint, 'updatedAt'>) => void
}

const KEY = 'compromised:starting-point'
const TIMEOUT_MS = 10_000
const RETRY_MS = 30_000

interface Stored {
  point: StartingPoint | null
  /** An edit the server hasn't taken yet. */
  pending: boolean
}

/**
 * The Starting point, local-first like Pain reports: answered once at first
 * launch, edited in Settings after, and sent to the server on start, after an
 * edit, when the phone is back online or in front, and every 30 seconds while
 * an edit waits. The later edit wins, here and on the server.
 */
export function useStartingPoint(): StartingPointState {
  const [stored, setStored] = useState<Stored>(read)
  const [heard, setHeard] = useState(false)

  const flush = useCallback(async () => {
    const { point, pending } = read()
    try {
      const response = await fetch('/api/sync', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(pending ? { startingPoint: point } : {}),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      })
      // A 400 means this edit will never be taken as it is: stop sending it rather than retry forever.
      if (response.status === 400) {
        write({ ...read(), pending: false }, setStored)
        return
      }
      if (!response.ok) return
      const state: SyncState = await response.json()
      const current = read()
      write(
        {
          point: laterStartingPoint(current.point, clean(state.startingPoint)),
          pending: current.pending && current.point?.updatedAt !== point?.updatedAt,
        },
        setStored,
      )
    } catch {
      // Offline or timed out: try again later.
    } finally {
      setHeard(true)
    }
  }, [])

  useEffect(() => {
    const go = () => void flush()
    const visible = () => document.visibilityState === 'visible' && go()
    go()
    window.addEventListener('online', go)
    document.addEventListener('visibilitychange', visible)
    return () => {
      window.removeEventListener('online', go)
      document.removeEventListener('visibilitychange', visible)
    }
  }, [flush])

  useEffect(() => {
    if (!stored.pending) return
    const timer = window.setInterval(() => void flush(), RETRY_MS)
    return () => window.clearInterval(timer)
  }, [flush, stored.pending])

  const save = useCallback(
    (estimates: Omit<StartingPoint, 'updatedAt'>) => {
      const current = read()
      write({ point: { ...estimates, updatedAt: editedAt(current.point?.updatedAt) }, pending: true }, setStored)
      void flush()
    },
    [flush],
  )

  return { point: stored.point, answered: stored.point ? true : heard ? false : null, save }
}

const clean = (value: unknown): StartingPoint | null => {
  try {
    return value ? parseStartingPoint(value) : null
  } catch {
    return null
  }
}

/** Where storage is blocked, the Starting point lasts in memory until reload, and still syncs. */
let memory: Stored = { point: null, pending: false }

function read(): Stored {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return memory
    const value = JSON.parse(raw)
    return { point: clean(value?.point), pending: value?.pending === true }
  } catch {
    return memory
  }
}

function write(next: Stored, set: (s: Stored) => void) {
  memory = next
  set(next)
  try {
    localStorage.setItem(KEY, JSON.stringify(next))
  } catch {
    // Private mode or storage blocked.
  }
}
