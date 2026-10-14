import { useCallback, useEffect, useState } from 'react'
import type { SyncState } from '../domain/log'
import { mergePainReports, parsePainReport, type PainReport } from '../domain/pain'

export interface PainReports {
  reports: PainReport[]
  /** Counts at once on this device; the server hears of it when it can be reached. */
  report: (report: PainReport) => void
}

const KEY = 'compromised:pain'
const TIMEOUT_MS = 10_000
const RETRY_MS = 30_000

interface Stored {
  reports: PainReport[]
  /** Reports the server hasn't taken yet. */
  outbox: PainReport[]
}

/**
 * Pain reports, local-first like Session logs: the pain step comes at Start,
 * in the gym, where there may be no signal, and the Coach must hear of it
 * anyway. Kept in this device's storage with an outbox, sent to the server
 * on start, after a report, when the phone is back online or in front, and
 * every 30 seconds while any wait.
 */
export function usePainReports(): PainReports {
  const [stored, setStored] = useState<Stored>(read)

  const flush = useCallback(async () => {
    const { outbox } = read()
    let state: SyncState
    try {
      const response = await fetch('/api/sync', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ painReports: outbox }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      })
      // A 400 means these reports will never be taken as they are: drop them rather than retry forever.
      if (response.status === 400) {
        settle(null, outbox, setStored)
        return
      }
      if (!response.ok) return
      state = await response.json()
    } catch {
      return
    }
    settle(state.painReports ?? [], outbox, setStored)
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

  const waiting = stored.outbox.length > 0
  useEffect(() => {
    if (!waiting) return
    const timer = window.setInterval(() => void flush(), RETRY_MS)
    return () => window.clearInterval(timer)
  }, [flush, waiting])

  const report = useCallback(
    (r: PainReport) => {
      const current = read()
      write({ reports: mergePainReports(current.reports, [r]), outbox: [...current.outbox, r] }, setStored)
      void flush()
    },
    [flush],
  )

  return { reports: stored.reports, report }
}

/**
 * Takes the server's reports (null when it refused the batch, which is then
 * forgotten) and clears what was sent from the outbox, unless replaced meanwhile.
 */
function settle(theirs: PainReport[] | null, sentReports: PainReport[], set: (s: Stored) => void) {
  const current = read()
  const sent = new Set(sentReports.map((r) => `${r.id}@${r.updatedAt}`))
  const refused = new Set(sentReports.map((r) => r.id))
  write(
    {
      reports:
        theirs === null
          ? current.reports.filter((r) => !refused.has(r.id))
          : mergePainReports(current.reports, theirs.flatMap(clean)),
      outbox: current.outbox.filter((r) => !sent.has(`${r.id}@${r.updatedAt}`)),
    },
    set,
  )
}

const clean = (value: unknown): PainReport[] => {
  try {
    return [parsePainReport(value)]
  } catch {
    return []
  }
}

/** Where storage is blocked, reports last in memory until reload, and still sync. */
let memory: Stored = { reports: [], outbox: [] }

function read(): Stored {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return memory
    const value = JSON.parse(raw)
    return {
      reports: Array.isArray(value?.reports) ? value.reports.flatMap(clean) : [],
      outbox: Array.isArray(value?.outbox) ? value.outbox.flatMap(clean) : [],
    }
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
