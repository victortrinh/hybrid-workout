import { useSyncExternalStore } from 'react'

/**
 * A phone on its side: wider than tall, and too short for the portrait column.
 * The same query as the `sideways:` variant in styles.css. Orientation and
 * height, never the device: a tablet or a laptop held wide stays on the
 * portrait or desktop layout.
 */
export const SIDEWAYS = '(orientation: landscape) and (height < 32rem)'

function subscribe(onChange: () => void) {
  const query = window.matchMedia(SIDEWAYS)
  query.addEventListener('change', onChange)
  return () => query.removeEventListener('change', onChange)
}

/** True while the screen is sideways (SIDEWAYS), kept current as the phone turns. */
export function useSideways(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(SIDEWAYS).matches,
    () => false,
  )
}
