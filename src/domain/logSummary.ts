/**
 * What a Session log says happened, in one line: each lift's top set, a HYROX session's round times, the Fade, the reps held
 * on target, then the time and RPE. The Week page leads a logged Session with it.
 */
import { trained, type SessionLog, type SetLog } from './log'
import { clock } from './paces'
import { LIFT_NAME, SESSION_TYPES } from './program/describe'
import type { LiftId, SessionType } from './program/types'
import { fade } from './stations'

/** The Session types whose logs show the Fade: every one that runs between Stations. */
const FADE_TYPES: readonly SessionType[] = ['hyrox', 'race-simulation', 'compromised-run-test']

/** "Squat 185 lb × 5 · 45 min · RPE 7", or null when the log says nothing about this Session's work. */
export function logSummary(log: SessionLog, type: SessionType): string | null {
  // A Skipped Session wasn't done, a Swapped one was something else: its minutes aren't this Session's.
  if (!trained(log)) return null
  const parts = [
    topSets(log.sets),
    type === 'race-simulation' || type === 'compromised-run-test' ? simulationTotal(log, SESSION_TYPES[type].name) : roundTimes(log),
    FADE_TYPES.includes(type) && fadeWords(log),
    repsOnTarget(log),
    log.minutes !== null && `${log.minutes} min`,
    log.rpe !== null && `RPE ${log.rpe}`,
  ].filter((part): part is string => Boolean(part))
  return parts.length > 0 ? parts.join(' · ') : null
}

/** "Squat 185 lb × 5, RDL 135 lb × 6": the heaviest set of each lift, then the most reps. Bodyweight work is left out. */
function topSets(sets: SetLog[]): string | null {
  const top = new Map<LiftId, SetLog>()
  for (const set of sets) {
    if (set.lift === null || set.pounds === null) continue
    const best = top.get(set.lift)
    if (!best || set.pounds > best.pounds! || (set.pounds === best.pounds && set.reps > best.reps))
      top.set(set.lift, set)
  }
  if (top.size === 0) return null
  return [...top.values()].map((s) => `${LIFT_NAME[s.lift!]} ${s.pounds} lb × ${s.reps}`).join(', ')
}

function roundTimes(log: SessionLog): string | null {
  const times = log.stations
    .filter((line) => line.part === 'round' && line.seconds !== null)
    .sort((a, b) => a.round - b.round)
    .map((line) => clock(line.seconds!))
  if (times.length === 0) return null
  return `${times.length === 1 ? 'Round' : 'Rounds'} ${times.join(', ')}`
}

/** "Race simulation, 1:12:40": every run and Station split added up. */
function simulationTotal(log: SessionLog, name: string): string | null {
  const splits = log.stations.filter((line) => line.part !== 'round' && line.seconds !== null)
  if (splits.length === 0) return null
  const total = splits.reduce((sum, line) => sum + line.seconds!, 0)
  const hours = Math.floor(total / 3600)
  const rest = clock(total % 3600)
  return `${name}, ${hours > 0 ? `${hours}:${rest.padStart(5, '0')}` : rest}`
}

/** Only reps run against a target pace count: RPE-only reps have nothing to hold. */
function repsOnTarget(log: SessionLog): string | null {
  const targeted = log.intervals.filter((rep) => rep.targetPace !== null)
  if (targeted.length === 0) return null
  return `${targeted.filter((rep) => rep.held).length} of ${targeted.length} reps on target`
}

/** "Fade +12 s/km": how much slower the last run was than the first. */
export function fadeWords(log: SessionLog): string | null {
  const seconds = fade(log)
  if (seconds === null) return null
  return `Fade ${seconds > 0 ? '+' : seconds < 0 ? '−' : ''}${Math.abs(seconds)} s/km`
}
