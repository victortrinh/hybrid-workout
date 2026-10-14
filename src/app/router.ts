/**
 * A three-screen router on the History API. react-aria-components' Link uses
 * `navigate` through RouterProvider, so links stay real <a href> elements.
 */
import { useSyncExternalStore } from 'react'

export type Screen = 'today' | 'plan' | 'week' | 'progress' | 'not-found'

const PATHS: Record<string, Screen> = { '/': 'today', '/plan': 'plan', '/progress': 'progress' }

export const SCREEN_PATH: Record<Exclude<Screen, 'week' | 'not-found'>, string> = {
  today: '/',
  plan: '/plan',
  progress: '/progress',
}

export const weekPath = (week: number) => `/plan/week/${week}`

const WEEK_PATH = /^\/plan\/week\/([1-9]\d?)$/

export interface Route {
  screen: Screen
  /** The Week number in /plan/week/N; the screen checks it against the Program. */
  week?: number
}

const NAVIGATE_EVENT = 'compromised:navigate'

export function navigate(path: string) {
  if (path === location.pathname) return
  history.pushState(null, '', path)
  window.dispatchEvent(new Event(NAVIGATE_EVENT))
}

function subscribe(onChange: () => void) {
  window.addEventListener('popstate', onChange)
  window.addEventListener(NAVIGATE_EVENT, onChange)
  return () => {
    window.removeEventListener('popstate', onChange)
    window.removeEventListener(NAVIGATE_EVENT, onChange)
  }
}

export function useRoute(): Route {
  const raw = useSyncExternalStore(subscribe, () => location.pathname)
  const path = raw.replace(/\/+$/, '') || '/'
  const week = WEEK_PATH.exec(path)
  if (week) return { screen: 'week', week: Number(week[1]) }
  return { screen: PATHS[path] ?? 'not-found' }
}
