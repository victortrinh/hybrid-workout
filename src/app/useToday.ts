import { useEffect, useState } from 'react'
import { localDateIn, type LocalDate } from '../domain/calendar'

/**
 * Today's date in America/Toronto. Rechecked every minute and whenever the
 * app comes back to the foreground, so a phone left on Today overnight wakes
 * up on the right day.
 */
export function useToday(): LocalDate {
  const [today, setToday] = useState(() => localDateIn(new Date()))
  useEffect(() => {
    const check = () => setToday(localDateIn(new Date()))
    const timer = window.setInterval(check, 60_000)
    document.addEventListener('visibilitychange', check)
    return () => {
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', check)
    }
  }, [])
  return today
}
