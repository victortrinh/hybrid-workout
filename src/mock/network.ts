/**
 * The mock panel's network control: what stands between the app and the
 * Worker in the browser. The mode lasts for the tab, across reloads, until
 * it's changed or the scenario is.
 */
import type { NetworkMode } from './controls'

/** How long Slow holds each answer back. */
export const SLOW_MS = 3_000

/** Where the mode lasts for the tab. A scenario switch clears it. */
export const NETWORK_KEY = 'compromised:mock-network'
const MODES: readonly NetworkMode[] = ['online', 'offline', 'server-error', 'slow']

/** Answers `request` the way the network in `mode` would. */
export async function throughNetwork(
  mode: NetworkMode,
  request: Request,
  api: (request: Request) => Promise<Response>,
  wait: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
): Promise<Response> {
  if (mode === 'offline') return Response.error()
  if (mode === 'server-error') return Response.json({ error: 'Mock server error' }, { status: 500 })
  if (mode === 'slow') await wait(SLOW_MS)
  return api(request)
}

export interface Network {
  mode(): NetworkMode
  set(mode: NetworkMode): void
  subscribe(listener: () => void): () => void
}

export function network(): Network {
  let mode = restore()
  const listeners = new Set<() => void>()
  return {
    mode: () => mode,
    set(next) {
      if (next === mode) return
      mode = next
      try {
        sessionStorage.setItem(NETWORK_KEY, mode)
      } catch {
        // Storage blocked: the mode lasts until the next reload.
      }
      for (const listener of listeners) listener()
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
}

function restore(): NetworkMode {
  try {
    const saved = sessionStorage.getItem(NETWORK_KEY) as NetworkMode | null
    return saved && MODES.includes(saved) ? saved : 'online'
  } catch {
    return 'online'
  }
}
