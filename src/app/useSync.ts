import { useCallback, useEffect, useState } from 'react'
import { mergeLogs, type SessionLog, type SyncState } from '../domain/log'
import { mergeDecisions, type SuggestionDecision } from '../domain/suggestion'

export interface Synced {
  logs: SessionLog[]
  decisions: SuggestionDecision[]
  /** Shows the log at once, then sends it to the server. Resolves false if the server didn't take it. */
  save: (log: SessionLog) => Promise<boolean>
  /** Shows the decision at once, then sends it to the server. Resolves false if the server didn't take it. */
  decide: (decision: SuggestionDecision) => Promise<boolean>
  /** What went wrong with the last load or save, for the athlete to read. */
  error: string | null
}

const EMPTY: SyncState = { sessionLogs: [], suggestionDecisions: [] }

/** Both states, keeping the later edit of every record. */
const merge = (ours: SyncState, theirs: SyncState): SyncState => ({
  sessionLogs: mergeLogs(ours.sessionLogs, theirs.sessionLogs),
  suggestionDecisions: mergeDecisions(ours.suggestionDecisions, theirs.suggestionDecisions),
})

/**
 * Session logs and Suggestion decisions, from the server and from this
 * device. A change shows straight away; if the server refuses it or can't be
 * reached, it comes back out and `error` says so. Offline logging arrives
 * with the local store.
 */
export function useSync(): Synced {
  const [state, setState] = useState<SyncState>(EMPTY)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    request('/api/state')
      .then((theirs) => {
        if (!cancelled) setState((ours) => merge(ours, theirs))
      })
      .catch(() => {
        if (!cancelled) setError('Couldn’t load your logs. The Bucket may be out of date.')
      })
    return () => {
      cancelled = true
    }
  }, [])

  /** Applies one record locally, syncs it, and puts back what was there if the server says no. */
  const send = useCallback(async (change: Partial<SyncState>, id: string, failure: string) => {
    let previous: SyncState = EMPTY
    setState((ours) => {
      previous = ours
      return merge(ours, { ...EMPTY, ...change })
    })
    setError(null)
    try {
      const theirs = await request('/api/sync', { method: 'POST', body: JSON.stringify(change) })
      setState((ours) => merge(ours, theirs))
      return true
    } catch {
      setState((ours) => ({
        sessionLogs: restore(ours.sessionLogs, previous.sessionLogs, id),
        suggestionDecisions: restore(ours.suggestionDecisions, previous.suggestionDecisions, id),
      }))
      setError(failure)
      return false
    }
  }, [])

  const save = useCallback(
    (log: SessionLog) =>
      send({ sessionLogs: [log] }, log.id, 'Couldn’t save that log. Check the connection and log it again.'),
    [send],
  )
  const decide = useCallback(
    (decision: SuggestionDecision) =>
      send({ suggestionDecisions: [decision] }, decision.id, 'Couldn’t save that. Check the connection and try again.'),
    [send],
  )

  return { logs: state.sessionLogs, decisions: state.suggestionDecisions, save, decide, error }
}

/** Now, or just after the edit it replaces if this device's clock is behind the one that wrote it: the later edit must win on sync. */
export function editedAt(previous: string | undefined): string {
  const now = Date.now()
  return new Date(Math.max(now, previous ? Date.parse(previous) + 1 : now)).toISOString()
}

/** `ours` with record `id` as it was in `before`, or without it if it wasn't there. */
function restore<T extends { id: string }>(ours: T[], before: T[], id: string): T[] {
  const was = before.find((r) => r.id === id)
  const rest = ours.filter((r) => r.id !== id)
  return was ? [...rest, was] : rest
}

async function request(path: string, init?: RequestInit): Promise<SyncState> {
  const response = await fetch(path, { ...init, headers: { 'content-type': 'application/json' } })
  if (!response.ok) throw new Error(`${path} answered ${response.status}`)
  return response.json()
}
