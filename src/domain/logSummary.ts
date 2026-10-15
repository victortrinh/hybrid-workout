/**
 * What a Session log says happened, in one line: the 5K test's time, each
 * lift's top set, a HYROX session's round times, the reps held on target,
 * then the time and RPE. The Week page leads a logged Session with it.
 */
import { trained, type SessionLog, type SetLog } from './log'
import { clock } from './paces'
import { LIFT_NAME } from './program/describe'
import type { LiftId, SessionType } from './program/types'

/** "5K test, 23:00 · RPE 9", or null when the log says nothing about this Session's work. */
export function logSummary(log: SessionLog, type: SessionType): string | null {
  // A Skipped Session wasn't done, a Swapped one was something else: its minutes aren't this Session's.
  if (!trained(log)) return null
  const parts = [
    type === '5k-test' && log.resultSeconds !== null && `5K test, ${clock(log.resultSeconds)}`,
    topSets(log.sets),
    type === 'race-simulation' ? simulationTotal(log) : roundTimes(log),
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

function simulationTotal(log: SessionLog): string | null {
  const splits = log.stations.filter((line) => line.part !== 'round' && line.seconds !== null)
  if (splits.length === 0) return null
  const total = splits.reduce((sum, line) => sum + line.seconds!, 0)
  const hours = Math.floor(total / 3600)
  const rest = clock(total % 3600)
  return `Race simulation, ${hours > 0 ? `${hours}:${rest.padStart(5, '0')}` : rest}`
}

/** Only reps run against a target pace count: RPE-only reps have nothing to hold. */
function repsOnTarget(log: SessionLog): string | null {
  const targeted = log.intervals.filter((rep) => rep.targetPace !== null)
  if (targeted.length === 0) return null
  return `${targeted.filter((rep) => rep.held).length} of ${targeted.length} reps on target`
}
