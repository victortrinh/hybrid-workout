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

/** A morning's numbers, as the Recovery Shortcut reads them from the ring. */
export interface NightFields {
  sleepMinutes: number
  hrvMs: number | null
  restingHeartRate: number | null
  /** Also send a normal night for each of the 7 before it that has none, so HRV has a mean to fall under. */
  baseline: boolean
}

/** One Apple Watch workout on the pinned today, as the Workout Shortcut reads it from Apple Health. */
export interface WorkoutFields {
  /** Apple Health's workout type: `Running`, `Traditional Strength Training`, `Functional Strength Training`. */
  type: string
  /** `HH:MM` in Toronto. */
  start: string
  minutes: number
  /** Runs only; null sends no distance. */
  distanceKm: number | null
  averageHeartRate: number
}

/** What a send did, in a line for the panel. */
export interface SendOutcome {
  ok: boolean
  message: string
}

export interface MockControls {
  network(): NetworkMode
  setNetwork(mode: NetworkMode): void
  /** Calls `listener` on every change of network mode. */
  subscribe(listener: () => void): () => void
  /** Today, as the (possibly pinned) clock has it. */
  today(): LocalDate
  defaults: { night: NightFields; workout: WorkoutFields }
  /** Posts the night for today to `/api/recovery`, as the Shortcut does, then has the app read its state again. */
  sendNight(fields: NightFields): Promise<SendOutcome>
  /** Posts the workout to `/api/activities`, as the Shortcut does, then has the app read its state again. */
  sendWorkout(fields: WorkoutFields): Promise<SendOutcome>
}
