import { useEffect, useState } from 'react'
import type { SyncState } from '../domain/log'
import { mergeNights, parseRecoveryNight, type RecoveryNight } from '../domain/recovery'

const KEY = 'compromised:recovery'
const TIMEOUT_MS = 10_000

/**
 * Recovery data, as the morning Shortcut sent it to the server. Read-only
 * here: the phone never writes a night. Kept in this device's storage so the
 * Coach still has last night in the gym without signal, and fetched again
 * whenever the app comes back to the front, which is when a new morning's
 * night will have arrived.
 */
export function useRecovery(): RecoveryNight[] {
  const [nights, setNights] = useState<RecoveryNight[]>(read)

  useEffect(() => {
    const fetchNights = async () => {
      let state: SyncState
      try {
        const response = await fetch('/api/state', { signal: AbortSignal.timeout(TIMEOUT_MS) })
        if (!response.ok) return
        state = await response.json()
      } catch {
        return
      }
      const next = mergeNights(read(), (state.recoveryNights ?? []).flatMap(clean))
      write(next)
      setNights(next)
    }
    const visible = () => document.visibilityState === 'visible' && void fetchNights()
    void fetchNights()
    document.addEventListener('visibilitychange', visible)
    return () => document.removeEventListener('visibilitychange', visible)
  }, [])

  return nights
}

const clean = (value: unknown): RecoveryNight[] => {
  try {
    const v = value as RecoveryNight
    return [parseRecoveryNight(v, typeof v.receivedAt === 'string' ? v.receivedAt : '')]
  } catch {
    return []
  }
}

/** Where storage is blocked, nights last in memory until reload. */
let memory: RecoveryNight[] = []

function read(): RecoveryNight[] {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return memory
    const value = JSON.parse(raw)
    return Array.isArray(value) ? value.flatMap(clean) : []
  } catch {
    return memory
  }
}

function write(nights: RecoveryNight[]) {
  memory = nights
  try {
    localStorage.setItem(KEY, JSON.stringify(nights))
  } catch {
    // Private mode or storage blocked.
  }
}
