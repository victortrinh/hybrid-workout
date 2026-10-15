/**
 * The race plan: what the athlete wants the night before a HYROX and on the
 * morning of it. Every Station in race order at its Race load, a split for
 * each from the Race simulations, the 1 km run pace and a finish estimate.
 *
 * Pure, like the rest of the Coach (ADR-0002). Only Race simulations count:
 * a HYROX round is timed as a whole, so it is never a Station split.
 */
import { daysBetween, type LocalDate } from './calendar'
import { findWeek } from './coach'
import { logFor, trained, type SessionLog } from './log'
import type { Program, Station, StationId } from './program/types'

/**
 * Time in the Roxzone, between the runs and the Stations, that a gym's
 * Race simulation never had: a guess, said as one.
 */
export const ROXZONE_SECONDS = 5 * 60

export interface RaceLeg {
  station: StationId
  /**
   * The Station's split at race volume and the Week it was timed in. `scaled`
   * when it was done at less than race volume and stretched to it. Null when
   * no Race simulation timed it.
   */
  split: { seconds: number; week: number; scaled: boolean } | null
}

export interface RacePlan {
  /** The eight Stations in race order. */
  legs: RaceLeg[]
  /** Average 1 km of the latest Race simulation that timed its runs. */
  run: { secondsPerKm: number; week: number } | null
  /** Eight runs at that pace, every Station's split and the Roxzone; null while anything is missing. */
  finish: number | null
  /** The Weeks whose Race simulations gave a split or the pace, in order. */
  simulations: number[]
}

/** The day before Race day, and Race day. */
export function showsRacePlan(daysToRace: number): boolean {
  return daysToRace === 0 || daysToRace === 1
}

export function racePlan(program: Program, logs: SessionLog[], today: LocalDate): RacePlan {
  const simulations = logs
    // One log stands for each Session: the latest edit.
    .filter((log) => logFor(logs, log.week, log.sessionId) === log)
    .filter((log) => trained(log) && daysBetween(log.date, today) >= 0)
    .filter((log) => findWeek(program, log.week)?.sessions.find((s) => s.id === log.sessionId)?.type === 'race-simulation')
    .sort((a, b) => a.date.localeCompare(b.date) || a.week - b.week)

  const order = (Object.values(program.stations) as Station[]).sort((a, b) => a.order - b.order)
  const used = new Set<number>()

  const legs = order.map((station): RaceLeg => {
    let full: RaceLeg['split'] = null
    let scaled: RaceLeg['split'] = null
    for (const log of simulations) {
      for (const line of log.stations) {
        if (line.part !== station.id || line.seconds === null) continue
        const share = volumeShare(station, line.meters, line.reps)
        if (share >= 1) full = { seconds: line.seconds, week: log.week, scaled: false }
        else scaled = { seconds: Math.round(line.seconds / share), week: log.week, scaled: true }
      }
    }
    const split = full ?? scaled
    if (split) used.add(split.week)
    return { station: station.id, split }
  })

  let run: RacePlan['run'] = null
  for (const log of simulations) {
    const runs = log.stations.filter((l) => l.part === 'run' && l.seconds !== null && l.meters)
    if (runs.length === 0) continue
    const seconds = runs.reduce((sum, l) => sum + l.seconds!, 0)
    const meters = runs.reduce((sum, l) => sum + l.meters!, 0)
    run = { secondsPerKm: Math.round((seconds / meters) * 1000), week: log.week }
  }
  if (run) used.add(run.week)

  const finish =
    run && legs.every((l) => l.split)
      ? 8 * run.secondsPerKm + legs.reduce((sum, l) => sum + l.split!.seconds, 0) + ROXZONE_SECONDS
      : null

  return { legs, run, finish, simulations: [...used].sort((a, b) => a - b) }
}

/** How much of race volume a logged Station was; a line without a distance or reps counts as all of it. */
function volumeShare(station: Station, meters: number | null, reps: number | null): number {
  const race = station.raceLoad
  if (race.meters && meters) return meters / race.meters
  if (race.reps && reps) return reps / race.reps
  return 1
}
