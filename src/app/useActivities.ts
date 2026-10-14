import { useCallback, useEffect, useState } from 'react'
import { mergeAnswers, parseActivity, parseActivityAnswer, type Activity, type ActivityAnswer } from '../domain/activity'
import type { SyncState } from '../domain/log'

const KEY = 'compromised:activities'
const TIMEOUT_MS = 10_000

export interface Activities {
  activities: Activity[]
  answers: ActivityAnswer[]
  /** Shows the answer at once, then sends it; takes it back if the server can't be reached. */
  answer: (answer: ActivityAnswer) => void
  /** An answer that didn't reach the server, for the athlete to read. */
  error: string | null
}

/**
 * Workouts the Workout Shortcut sent (ADR-0004), and the athlete's answers to
 * "Which Session was this?". Kept in this device's storage so a workout stays
 * attached without signal, and fetched again whenever the app comes back to
 * the front, which is when a just-finished workout will have arrived. Answers
 * are given on Today, online, like a Suggestion's decision.
 */
export function useActivities(): Activities {
  const [stored, setStored] = useState(read)
  const [error, setError] = useState<string | null>(null)

  const take = useCallback((state: SyncState) => {
    const next = {
      activities: merge(read().activities, (state.activities ?? []).flatMap(cleanActivity)),
      answers: mergeAnswers(read().answers, (state.activityAnswers ?? []).flatMap(cleanAnswer)),
    }
    write(next)
    setStored(next)
  }, [])

  useEffect(() => {
    const fetchState = async () => {
      try {
        const response = await fetch('/api/state', { signal: AbortSignal.timeout(TIMEOUT_MS) })
        if (response.ok) take(await response.json())
      } catch {
        // Offline: what this device already has stands.
      }
    }
    const visible = () => document.visibilityState === 'visible' && void fetchState()
    void fetchState()
    document.addEventListener('visibilitychange', visible)
    return () => document.removeEventListener('visibilitychange', visible)
  }, [take])

  const answer = useCallback(
    async (given: ActivityAnswer) => {
      const before = read()
      const shown = { ...before, answers: mergeAnswers(before.answers, [given]) }
      setStored(shown)
      setError(null)
      try {
        const response = await fetch('/api/sync', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ activityAnswers: [given] }),
          signal: AbortSignal.timeout(TIMEOUT_MS),
        })
        if (!response.ok) throw new Error(`/api/sync answered ${response.status}`)
        write(shown)
        take(await response.json())
      } catch {
        setStored(before)
        setError('Couldn’t save that. Check the connection and try again.')
      }
    },
    [take],
  )

  return { ...stored, answer: (a) => void answer(a), error }
}

/** One per workout, keeping the later arrival. */
function merge(ours: Activity[], theirs: Activity[]): Activity[] {
  const byId = new Map(ours.map((a) => [a.id, a]))
  for (const a of theirs) {
    const mine = byId.get(a.id)
    if (!mine || a.receivedAt > mine.receivedAt) byId.set(a.id, a)
  }
  return [...byId.values()].sort((a, b) => a.startedAt.localeCompare(b.startedAt))
}

const cleanActivity = (value: unknown): Activity[] => {
  try {
    const v = value as Activity
    // Stored and served Activities carry their start and minutes, not an end.
    return [parseActivity({ ...v, type: v.workoutType, start: v.startedAt }, v.receivedAt)]
  } catch {
    return []
  }
}

const cleanAnswer = (value: unknown): ActivityAnswer[] => {
  try {
    return [parseActivityAnswer(value)]
  } catch {
    return []
  }
}

interface Stored {
  activities: Activity[]
  answers: ActivityAnswer[]
}

/** Where storage is blocked, they last in memory until reload. */
let memory: Stored = { activities: [], answers: [] }

function read(): Stored {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return memory
    const value = JSON.parse(raw) as Partial<Stored>
    return {
      activities: Array.isArray(value.activities) ? value.activities.flatMap(cleanActivity) : [],
      answers: Array.isArray(value.answers) ? value.answers.flatMap(cleanAnswer) : [],
    }
  } catch {
    return memory
  }
}

function write(value: Stored) {
  memory = value
  try {
    localStorage.setItem(KEY, JSON.stringify(value))
  } catch {
    // Storage full or blocked: memory holds them for this visit.
  }
}
