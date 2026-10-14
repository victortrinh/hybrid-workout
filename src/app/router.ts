/**
 * A small router on the History API. react-aria-components' Link uses
 * `navigate` through RouterProvider, so links stay real <a href> elements.
 */
import { useSyncExternalStore } from 'react'

export type Screen = 'today' | 'log' | 'live' | 'plan' | 'week' | 'progress' | 'shortcut' | 'workouts' | 'not-found'

const PATHS: Record<string, Screen> = {
  '/': 'today',
  '/live': 'live',
  '/plan': 'plan',
  '/progress': 'progress',
  '/settings/shortcut': 'shortcut',
  '/settings/workouts': 'workouts',
}

export const SCREEN_PATH: Record<Exclude<Screen, 'log' | 'week' | 'not-found'>, string> = {
  today: '/',
  /** The Live session running on this device, whichever it is. */
  live: '/live',
  plan: '/plan',
  progress: '/progress',
  /** Settings → Recovery Shortcut: how to set up the morning iOS Shortcut. */
  shortcut: '/settings/shortcut',
  /** Settings → Workout Shortcut: how to send Apple Watch workouts from Apple Health. */
  workouts: '/settings/workouts',
}

export const weekPath = (week: number) => `/plan/week/${week}`

const WEEK_PATH = /^\/plan\/week\/([1-9]\d?)$/

/** Log after for one Session of a Week. */
export const logPath = (week: number, sessionId: string) => `/log/${week}/${sessionId}`

const LOG_PATH = /^\/log\/([1-9]\d?)\/([a-z0-9-]+)$/

export interface Route {
  screen: Screen
  /** The Week number in /plan/week/N or /log/N/…; the screen checks it against the Program. */
  week?: number
  /** The Session id in /log/N/id. */
  sessionId?: string
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
  const log = LOG_PATH.exec(path)
  if (log) return { screen: 'log', week: Number(log[1]), sessionId: log[2] }
  return { screen: PATHS[path] ?? 'not-found' }
}
