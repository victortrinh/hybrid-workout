import { useCallback, useState } from 'react'
import { parseLiveSession, type LiveSession } from '../domain/lifts'

const KEY = 'compromised:live'

/**
 * The Live session in progress, kept on this device so it survives a reload
 * or the phone locking: it's timestamps, so time that passed while the page
 * was gone is still counted when it comes back. Null when nothing is running.
 * If storage is blocked the session lasts until reload.
 */
export function useLiveRun(): [LiveSession | null, (live: LiveSession | null) => void] {
  const [live, setLive] = useState<LiveSession | null>(read)
  const change = useCallback((next: LiveSession | null) => {
    setLive(next)
    try {
      if (next) localStorage.setItem(KEY, JSON.stringify(next))
      else localStorage.removeItem(KEY)
    } catch {
      // Private mode or storage blocked.
    }
  }, [])
  return [live, change]
}

function read(): LiveSession | null {
  try {
    const raw = localStorage.getItem(KEY)
    return raw ? parseLiveSession(JSON.parse(raw)) : null
  } catch {
    return null
  }
}
