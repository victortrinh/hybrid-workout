/**
 * A three-screen router on the History API. react-aria-components' Link uses
 * `navigate` through RouterProvider, so links stay real <a href> elements.
 */
import { useSyncExternalStore } from 'react'

export type Screen = 'today' | 'plan' | 'progress' | 'not-found'

const PATHS: Record<string, Screen> = { '/': 'today', '/plan': 'plan', '/progress': 'progress' }

export const SCREEN_PATH: Record<Exclude<Screen, 'not-found'>, string> = {
  today: '/',
  plan: '/plan',
  progress: '/progress',
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

export function useScreen(): Screen {
  const path = useSyncExternalStore(subscribe, () => location.pathname)
  return PATHS[path.replace(/\/+$/, '') || '/'] ?? 'not-found'
}
