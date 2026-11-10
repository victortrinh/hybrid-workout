/**
 * What the Station logs say: each Station's Station best and Station target,
 * and which Station a Deload HYROX session drops. The Fade is paces.ts's.
 *
 * Pure like the Coach (ADR-0002). Progression is Station volume first, then
 * time: the Station target asks for the Station best again, or about 3% under
 * it once the last two logs at that volume felt easy enough.
 */
import { trained, type SessionLog, type StationLog } from './log'
import { stationPounds } from './program/describe'
import type { TrainingPaces } from './paces'
import {
  DEFAULT_RACE_RUN,
  defaultStationSeconds,
  volumeShare,
  withHyroxMinutes,
  type StationVolume,
} from './program/hyroxMinutes'
import { stations } from './program/program'
import type { Block, Program, Session, StationId, Week } from './program/types'

export type { StationVolume }

/** The Station target once the last two logs at a volume were RPE 7 or under: the best less this share. */
export const TARGET_SHARE = 0.97

/** The RPE at or under which a log counts as easy enough to ask for more. */
export const EASY_ENOUGH_RPE = 7

/** Logs at a volume before the Station gets a Station target. */
const LOGS_FOR_TARGET = 2

/** A Station's line done at Race load: a lighter load is another Station. Stations with nothing to load always are. */
const atRaceLoad = (line: StationLog, id: StationId) => {
  const race = stationPounds(stations[id])
  return race === null || (line.pounds !== null && line.pounds >= race)
}

const sameVolume = (line: StationLog, volume: StationVolume) =>
  line.meters === (volume.meters ?? null) && line.reps === (volume.reps ?? null)

const byDate = (a: SessionLog, b: SessionLog) => a.date.localeCompare(b.date) || a.updatedAt.localeCompare(b.updatedAt)

/** Each trained Session log's fastest timed line of a Station at Race load, in the order they were done. */
function timedLines(logs: readonly SessionLog[], id: StationId, volume?: StationVolume): { log: SessionLog; line: StationLog }[] {
  return logs
    .filter(trained)
    .toSorted(byDate)
    .flatMap((log) => {
      const lines = log.stations.filter(
        (l) => l.part === id && l.seconds !== null && atRaceLoad(l, id) && (!volume || sameVolume(l, volume)),
      )
      if (lines.length === 0) return []
      const line = lines.reduce((best, l) => (l.seconds! < best.seconds! ? l : best))
      return [{ log, line }]
    })
}

/** The fastest time logged for a Station at this Station volume, at Race load; null before any. */
export function stationBest(logs: readonly SessionLog[], id: StationId, volume: StationVolume): number | null {
  const times = timedLines(logs, id, volume).map(({ line }) => line.seconds!)
  return times.length === 0 ? null : Math.min(...times)
}

/**
 * How long a Station is expected to take at this volume, in seconds: its
 * Station best there; otherwise the best at the logged volume nearest it,
 * scaled by share (seconds ÷ share, as racePlan.ts does); otherwise the
 * fixed default (program/hyroxMinutes.ts). Race load only, like the best.
 */
export function stationEstimate(logs: readonly SessionLog[], id: StationId, volume: StationVolume): number {
  const best = stationBest(logs, id, volume)
  if (best !== null) return best
  const wanted = volumeShare(stations[id], volume)
  let nearest: { seconds: number; share: number } | null = null
  for (const { line } of timedLines(logs, id)) {
    // How much of the wanted volume the logged line was.
    const share = volumeShare(stations[id], { meters: line.meters ?? undefined, reps: line.reps ?? undefined }) / wanted
    const seconds = line.seconds!
    const closer = !nearest || Math.abs(Math.log(share)) < Math.abs(Math.log(nearest.share))
    if (closer || (share === nearest!.share && seconds < nearest!.seconds)) nearest = { seconds, share }
  }
  return nearest ? Math.round(nearest.seconds / nearest.share) : defaultStationSeconds(stations[id], volume)
}

/**
 * Every HYROX Session of the Week with its minutes calculated from the
 * athlete's Race run pace and Station estimates. Without Training paces the
 * Program's default pace stands in. Like the Station rules, only the Weeks
 * before count, so a Session's own log never moves its minutes.
 */
export function hyroxMinutes(week: Week, logs: readonly SessionLog[], paces: TrainingPaces | null): Week {
  if (!week.sessions.some((s) => s.type === 'hyrox')) return week
  const before = logs.filter((l) => l.week < week.number)
  const raceRun = paces?.raceRun ?? DEFAULT_RACE_RUN
  const estimate = (id: StationId, volume: StationVolume) => stationEstimate(before, id, volume)
  const sessions = week.sessions.map((s) => withHyroxMinutes(s, raceRun, estimate))
  return sessions.every((s, i) => s === week.sessions[i]) ? week : { ...week, sessions }
}

/**
 * The time to beat at this Station volume: the Station best, or the best
 * less 3% to the second once the last two logs at it came in at RPE 7 or
 * under. None until two logs at the volume. Deloads and the Taper are the
 * Coach's to leave out (`stationRules`).
 */
export function stationTarget(logs: readonly SessionLog[], id: StationId, volume: StationVolume): number | null {
  const timed = timedLines(logs, id, volume)
  if (timed.length < LOGS_FOR_TARGET) return null
  const best = Math.min(...timed.map(({ line }) => line.seconds!))
  const easy = timed.slice(-LOGS_FOR_TARGET).every(({ log }) => log.rpe !== null && log.rpe <= EASY_ENOUGH_RPE)
  return easy ? Math.round(best * TARGET_SHARE) : best
}

/**
 * The Station rules applied to a Week as the Coach prescribes it: a
 * Deload HYROX session drops the Station done best last time, and every
 * HYROX Station gets its Station target, except in a Deload week or the
 * Taper. Only the Weeks before count, so a Session's own log never moves
 * what it was asked to beat.
 */
export function stationRules(program: Program, week: Week, logs: readonly SessionLog[]): Week {
  const before = logs.filter((l) => l.week < week.number)
  const taper = program.phases.some((p) => p.id === 'taper' && week.number >= p.firstWeek && week.number <= p.lastWeek)
  const targetsOff = week.deload || taper
  const sessions = week.sessions.map((session) => {
    if (session.type !== 'hyrox') return session
    const dropped = dropBestLastTime(session, before)
    return targetsOff ? dropped : withTargets(dropped, before)
  })
  return sessions.every((s, i) => s === week.sessions[i]) ? week : { ...week, sessions }
}

/** Every Station of the Session with its Station target, where it has one. */
function withTargets(session: Session, logs: readonly SessionLog[]): Session {
  const blocks = session.blocks.map((block) => {
    if (block.setup) return block
    const exercises = block.exercises.map((exercise) => {
      const rx = exercise.prescription
      if (rx.kind !== 'station') return exercise
      const target = stationTarget(logs, rx.station, rx)
      return target === null ? exercise : { ...exercise, prescription: { ...rx, target } }
    })
    return exercises.some((e, i) => e !== block.exercises[i]) ? { ...block, exercises } : block
  })
  // Untouched, it stays the very Session the Program holds.
  return blocks.some((b, i) => b !== session.blocks[i]) ? { ...session, blocks } : session
}

const roundStation = (block: Block): StationId | null => {
  const rx = block.exercises.find((e) => e.prescription.kind === 'station')?.prescription
  return rx?.kind === 'station' ? rx.station : null
}

/**
 * How close a Station's last log came to its Station best at that volume:
 * 1 when the last time was the best, more the slower it was. Infinity before
 * any log.
 */
function lastAgainstBest(logs: readonly SessionLog[], id: StationId): number {
  const timed = timedLines(logs, id)
  const last = timed.at(-1)
  if (!last) return Infinity
  const best = stationBest(logs, id, {
    meters: last.line.meters ?? undefined,
    reps: last.line.reps ?? undefined,
  })!
  return last.line.seconds! / best
}

/**
 * A Deload HYROX session without the Station done best last time: the one
 * whose last log came closest to its Station best. Ties, and no logs at all,
 * keep the Program's choice. The Stations kept stay in race order, and a
 * Session that goes through them twice still does, so every round of the
 * dropped Station gives way to the spare.
 */
function dropBestLastTime(session: Session, logs: readonly SessionLog[]): Session {
  const spare = session.spareRound
  const spareId = spare && roundStation(spare)
  if (!spare || !spareId) return session
  const rounds = session.blocks.filter((b) => b.main && roundStation(b) !== null)
  const ids = [...new Set(rounds.map((b) => roundStation(b)!))]
  const score = (id: StationId) => lastAgainstBest(logs, id)
  const drop = ids.reduce<StationId>((best, id) => (score(id) < score(best) ? id : best), spareId)
  if (drop === spareId) return session
  const kept = [...ids.filter((id) => id !== drop), spareId].toSorted((a, b) => stations[a].order - stations[b].order)
  const roundOf = (id: StationId) => (id === spareId ? spare : rounds.find((b) => roundStation(b) === id)!)
  const renamed = rounds.map((_, i) => ({ ...roundOf(kept[i % kept.length]), name: `Round ${i + 1}` }))
  const blocks = session.blocks.flatMap((b) => (b.setup ? setUpFor(b, kept) : [b]))
  const first = blocks.indexOf(rounds[0])
  return {
    ...session,
    blocks: [...blocks.slice(0, first), ...renamed, ...blocks.slice(first + rounds.length)],
    spareRound: { ...roundOf(drop), name: `Round ${rounds.length}` },
  }
}

/** Set up for the rounds kept: each Station with a load, in the order they come up. None when nothing loads. */
function setUpFor(block: Block, ids: StationId[]): Block[] {
  const loaded = ids.filter((id) => stations[id].raceLoad.pounds !== undefined)
  if (loaded.length === 0) return []
  const { note: _, ...rest } = block
  return [
    {
      ...rest,
      exercises: loaded.map((id) => ({
        name: stations[id].name,
        prescription: { kind: 'station', station: id },
      })),
      ...(loaded.length < ids.length && { note: 'Nothing else to load.' }),
    },
  ]
}
