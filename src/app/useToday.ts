import { useEffect, useState } from 'react'
import { localDateIn, type LocalDate } from '../domain/calendar'
import { nowDate } from '../domain/clock'

/**
 * Today's date in America/Toronto. Rechecked every minute and whenever the
 * app comes back to the foreground, so a phone left on Today overnight wakes
 * up on the right day.
 */
export function useToday(): LocalDate {
  const [today, setToday] = useState(() => localDateIn(nowDate()))
  useEffect(() => {
    const check = () => setToday(localDateIn(nowDate()))
    const timer = window.setInterval(check, 60_000)
    document.addEventListener('visibilitychange', check)
    return () => {
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', check)
    }
  }, [])
  return today
}
