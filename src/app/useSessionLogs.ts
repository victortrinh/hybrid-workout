import { useCallback, useEffect, useState } from 'react'
import { mergeLogs, type SessionLog, type SyncState } from '../domain/log'

export interface SessionLogs {
  logs: SessionLog[]
  /** Shows the log at once, then sends it to the server. Resolves false if the server didn't take it. */
  save: (log: SessionLog) => Promise<boolean>
  /** What went wrong with the last load or save, for the athlete to read. */
  error: string | null
}

/**
 * Session logs, from the server and from this device. A saved log shows
 * straight away; if the server refuses it or can't be reached, it comes back
 * out and `error` says so. Offline logging arrives with the local store.
 */
export function useSessionLogs(): SessionLogs {
  const [logs, setLogs] = useState<SessionLog[]>([])
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    request('/api/state')
      .then((state) => {
        if (!cancelled) setLogs((ours) => mergeLogs(ours, state.sessionLogs))
      })
      .catch(() => {
        if (!cancelled) setError('Couldn’t load your logs. The Bucket may be out of date.')
      })
    return () => {
      cancelled = true
    }
  }, [])

  const save = useCallback(async (log: SessionLog) => {
    let previous: SessionLog | undefined
    setLogs((ours) => {
      previous = ours.find((l) => l.id === log.id)
      return mergeLogs(ours, [log])
    })
    setError(null)
    try {
      const state = await request('/api/sync', { method: 'POST', body: JSON.stringify({ sessionLogs: [log] }) })
      setLogs((ours) => mergeLogs(ours, state.sessionLogs))
      return true
    } catch {
      setLogs((ours) => {
        const rest = ours.filter((l) => l.id !== log.id)
        return previous ? [...rest, previous] : rest
      })
      setError('Couldn’t save that log. Check the connection and log it again.')
      return false
    }
  }, [])

  return { logs, save, error }
}

async function request(path: string, init?: RequestInit): Promise<SyncState> {
  const response = await fetch(path, { ...init, headers: { 'content-type': 'application/json' } })
  if (!response.ok) throw new Error(`${path} answered ${response.status}`)
  return response.json()
}
