/**
 * What the mock panel (src/app/components/MockBadge.tsx) can do to mock mode:
 * types only, so the app imports nothing of mock mode but its shape. The
 * values come from `startMock()`, behind the VITE_API check.
 */
import type { LocalDate } from '../domain/calendar'

/**
 * How `/api/*` answers the app. Offline fails every request with a network
 * error, Server error answers 500, Slow waits 3 seconds before each answer.
 */
export type NetworkMode = 'online' | 'offline' | 'server-error' | 'slow'

export interface MockControls {
  network(): NetworkMode
  setNetwork(mode: NetworkMode): void
  /** Calls `listener` on every change of network mode. */
  subscribe(listener: () => void): () => void
  /** Today, as the (possibly pinned) clock has it. */
  today(): LocalDate
}
