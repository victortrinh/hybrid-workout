/**
 * The race card's words: each Station's Race load as the race sets it up,
 * and the Coach's notes for the night before and the morning of.
 */
import { clock } from '../domain/paces'
import type { Station } from '../domain/program/types'
import type { RacePlan } from '../domain/racePlan'

/** "1 km", "50 m · 335 lb with the sled", "200 m · 2 × 53 lb", "100 reps · 13 lb ball" */
export function raceLoadWords(station: Station): string {
  const { meters, reps, pounds, implements: count = 1, fixedLoad } = station.raceLoad
  const volume = meters ? (meters >= 1000 ? `${meters / 1000} km` : `${meters} m`) : reps ? `${reps} reps` : ''
  // In the race the sled's own weight is in the load, unlike the plates in the gym.
  const load =
    pounds === undefined
      ? ''
      : fixedLoad
        ? `${pounds} lb ball`
        : station.id === 'sled-push' || station.id === 'sled-pull'
          ? `${pounds} lb with the sled`
          : count > 1
            ? `${count} × ${pounds} lb`
            : `${pounds} lb bag`
  return [volume, load].filter(Boolean).join(' · ')
}

/** How much slower the first 1 km goes than the rest. */
export const FIRST_RUN_EASIER = 10

/** The Coach's notes: the first run, the heavy one, the last one, then what today is for. */
export function raceNotes(plan: RacePlan, raceDay: boolean, sledPush: Station): string[] {
  const first = plan.run
    ? `First 1 km at ${clock(plan.run.secondsPerKm + FIRST_RUN_EASIER)}, not ${clock(plan.run.secondsPerKm)}. Everyone goes out fast and pays for it on the sled.`
    : 'First 1 km slower than you want to. Everyone goes out fast and pays for it on the sled.'
  return [
    first,
    `Sled push is ${sledPush.raceLoad.pounds} lb with the sled, on carpet slower than the gym floor. Short steps, arms locked, don’t stop.`,
    '100 wall balls to finish. Sets of 20 with a breath between, before you fail, not after.',
    raceDay
      ? 'Eat 3 hours before. Warm up 15 minutes: easy jog, strides, a few wall balls. Nothing new today, shoes included.'
      : 'Tonight: kit out, the dinner you always eat, early bed. Nothing new tomorrow, shoes included.',
  ]
}

/** Where the splits came from, or that there are none: "Splits from Race simulations in Weeks 18, 21 and 24." */
export function sourceLine(plan: RacePlan): string {
  if (plan.simulations.length === 0) return 'No Race simulation logged, so no splits to go on. Race loads only.'
  const weeks = plan.simulations
  const list = weeks.length === 1 ? `Week ${weeks[0]}` : `Weeks ${weeks.slice(0, -1).join(', ')} and ${weeks.at(-1)}`
  const scaled = plan.legs.some((l) => l.split?.scaled)
  return `Splits from the Race simulation${weeks.length === 1 ? '' : 's'} in ${list}.${scaled ? ' Half-volume Stations doubled.' : ''}`
}

/** 4535 → "1:15:35" */
export function finishClock(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  return h > 0 ? `${h}:${clock(seconds - h * 3600).padStart(5, '0')}` : clock(seconds)
}
