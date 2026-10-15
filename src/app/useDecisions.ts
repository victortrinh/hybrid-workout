import { useCallback, useEffect, useState } from 'react'
import { nowMs } from '../domain/clock'
import type { SyncState } from '../domain/log'
import { mergeDecisions, type SuggestionDecision } from '../domain/suggestion'

export interface Decisions {
  decisions: SuggestionDecision[]
  /** Shows the decisions at once, then sends them to the server together; takes them all back if the server can't be reached. */
  decide: (...decisions: SuggestionDecision[]) => void
  /** A decision that didn't reach the server, for the athlete to read. */
  error: string | null
}

/**
 * The athlete's decisions on Suggestions. Unlike Session logs they aren't
 * kept on the device: a Suggestion is decided on Today, online, in one tap,
 * and if the server can't be reached the decision comes back out and the
 * Suggestion stays open.
 */
export function useDecisions(): Decisions {
  const [decisions, setDecisions] = useState<SuggestionDecision[]>([])
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    request('/api/state')
      .then((state) => {
        if (!cancelled) setDecisions((ours) => mergeDecisions(ours, state.suggestionDecisions))
      })
      .catch(() => {
        // Offline: no Suggestion shows as decided until the server answers.
      })
    return () => {
      cancelled = true
    }
  }, [])

  const decide = useCallback(async (...made: SuggestionDecision[]) => {
    const ids = new Set(made.map((d) => d.id))
    let previous: SuggestionDecision[] = []
    setDecisions((ours) => {
      previous = ours.filter((d) => ids.has(d.id))
      return mergeDecisions(ours, made)
    })
    setError(null)
    try {
      const state = await request('/api/sync', {
        method: 'POST',
        body: JSON.stringify({ suggestionDecisions: made }),
      })
      setDecisions((ours) => mergeDecisions(ours, state.suggestionDecisions))
    } catch {
      setDecisions((ours) => [...ours.filter((d) => !ids.has(d.id)), ...previous])
      setError('Couldn’t save that. Check the connection and try again.')
    }
  }, [])

  return { decisions, decide: (...d) => void decide(...d), error }
}

/** Now, or just after the decision it replaces if this device's clock is behind the one that wrote it: the later one must win on sync. */
export function editedAt(previous: string | undefined): string {
  const now = nowMs()
  return new Date(Math.max(now, previous ? Date.parse(previous) + 1 : now)).toISOString()
}

async function request(path: string, init?: RequestInit): Promise<SyncState> {
  const response = await fetch(path, { ...init, headers: { 'content-type': 'application/json' } })
  if (!response.ok) throw new Error(`${path} answered ${response.status}`)
  return response.json()
}
