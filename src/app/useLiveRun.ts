import { useCallback, useState } from 'react'
import { parseLiveRun, type LiveRun } from '../domain/live'

const KEY = 'compromised:live'

/**
 * The Live run session in progress, kept on this device so it survives a
 * reload or the phone locking: the run is timestamps, so time that passed
 * while the page was gone is still counted when it comes back. Null when
 * nothing is running. If storage is blocked the run lasts until reload.
 */
export function useLiveRun(): [LiveRun | null, (run: LiveRun | null) => void] {
  const [run, setRun] = useState<LiveRun | null>(read)
  const change = useCallback((next: LiveRun | null) => {
    setRun(next)
    try {
      if (next) localStorage.setItem(KEY, JSON.stringify(next))
      else localStorage.removeItem(KEY)
    } catch {
      // Private mode or storage blocked.
    }
  }, [])
  return [run, change]
}

function read(): LiveRun | null {
  try {
    const raw = localStorage.getItem(KEY)
    return raw ? parseLiveRun(JSON.parse(raw)) : null
  } catch {
    return null
  }
}
