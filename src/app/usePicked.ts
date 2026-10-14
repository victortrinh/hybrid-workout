import { useCallback, useState } from 'react'
import type { LocalDate } from '../domain/calendar'
import type { PickedSession } from '../domain/coach'

const KEY = 'compromised:picked'

/**
 * The Session tapped in the Bucket to do today instead of Up next. Kept on
 * this device so a reload doesn't undo the choice; the Coach ignores it from
 * tomorrow.
 */
export function usePicked(): [PickedSession | null, (week: number, sessionId: string, today: LocalDate) => void] {
  const [picked, setPicked] = useState<PickedSession | null>(read)
  const pick = useCallback((week: number, sessionId: string, today: LocalDate) => {
    const next = { date: today, week, sessionId }
    setPicked(next)
    try {
      localStorage.setItem(KEY, JSON.stringify(next))
    } catch {
      // Private mode or storage blocked: the pick lasts until reload.
    }
  }, [])
  return [picked, pick]
}

function read(): PickedSession | null {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return null
    const value = JSON.parse(raw)
    return typeof value?.date === 'string' && typeof value?.week === 'number' && typeof value?.sessionId === 'string'
      ? value
      : null
  } catch {
    return null
  }
}
