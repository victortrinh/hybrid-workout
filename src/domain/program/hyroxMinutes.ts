/**
 * A HYROX Session's minutes, calculated (#178): the warm-up and cooldown, each
 * run's meters at Race run pace, and each Station's expected seconds, rounded
 * to the nearest 5. Set up is never in them. 45 stays the Session cap, a
 * ceiling the minutes are checked against, not a target they are set to.
 *
 * Pure and log-free: the Program builds its Sessions with the defaults below,
 * and the Coach recalculates them from the athlete's Race run pace and
 * Station bests (stations.ts, `hyroxMinutes`).
 */
import type { Block, Session, Station, StationId } from './types'

/** A Station volume: its distance or its reps. */
export interface StationVolume {
  meters?: number
  reps?: number
}

/** The Race run pace the Program is written at before the Coach knows the athlete's, in seconds per km. */
export const DEFAULT_RACE_RUN = 5 * 60 + 15

/**
 * Each Station's seconds at race volume and Race load when the athlete has no
 * log of it at any volume: rounded mid-pack Men's Open splits, about a 1:25
 * finish, done solo with no partner to share the work. A guess, said as one,
 * and only until the first log. Any other volume is its share of race volume.
 */
export const DEFAULT_RACE_SECONDS: Record<StationId, number> = {
  skierg: 270, // 1000 m, about 2:15/500 m
  'sled-push': 180, // 50 m at 335 lb
  'sled-pull': 240, // 50 m at 227 lb, hand over hand
  'burpee-broad-jumps': 270, // 80 m
  row: 270, // 1000 m, about 2:15/500 m
  'farmers-carry': 120, // 200 m at 2 × 53 lb
  'sandbag-lunges': 270, // 100 m at 44 lb
  'wall-balls': 360, // 100 reps at 13 lb
}

/** How much of race volume a Station volume is; one without a distance or reps counts as all of it. */
export function volumeShare(station: Station, volume: StationVolume): number {
  const race = station.raceLoad
  if (race.meters && volume.meters) return volume.meters / race.meters
  if (race.reps && volume.reps) return volume.reps / race.reps
  return 1
}

/** The default seconds for a Station at a volume: its race-volume default, scaled by share. */
export const defaultStationSeconds = (station: Station, volume: StationVolume): number =>
  Math.round(DEFAULT_RACE_SECONDS[station.id] * volumeShare(station, volume))

/** A Station's expected seconds at a volume. */
export type StationSeconds = (id: StationId, volume: StationVolume) => number

/** A round's expected seconds: its run at Race run pace and its Station. */
function roundSeconds(block: Block, raceRun: number, stationSeconds: StationSeconds): number {
  return block.exercises.reduce((sum, { prescription: rx }) => {
    if (rx.kind === 'station') return sum + stationSeconds(rx.station, rx)
    if (rx.kind === 'run' && rx.meters) return sum + (rx.meters / 1000) * raceRun
    return sum
  }, 0)
}

/**
 * The HYROX Session with its minutes calculated: warm-up and cooldown as
 * written, every round at Race run pace plus its Station's expected seconds,
 * the total to the nearest 5. Each round's Block gets its share of the
 * rounds' minutes by how long it is expected to take, so the Blocks add up
 * to the Session. A spare round is timed the same way. Anything but HYROX
 * comes back as it is.
 */
export function withHyroxMinutes(session: Session, raceRun: number, stationSeconds: StationSeconds): Session {
  if (session.type !== 'hyrox') return session
  const fixed = session.blocks.filter((b) => !b.main && !b.setup).reduce((sum, b) => sum + (b.minutes ?? 0), 0)
  const seconds = (block: Block) => roundSeconds(block, raceRun, stationSeconds)
  const roundsTotal = session.blocks.filter((b) => b.main).reduce((sum, b) => sum + seconds(b), 0)
  const minutes = Math.round((fixed + roundsTotal / 60) / 5) * 5
  const perSecond = roundsTotal > 0 ? (minutes - fixed) / roundsTotal : 0
  const timed = (block: Block): Block => {
    const m = Math.floor(seconds(block) * perSecond * 10) / 10
    return m === block.minutes ? block : { ...block, minutes: m }
  }
  const blocks = session.blocks.map((b) => (b.main ? timed(b) : b))
  const spare = session.spareRound && timed(session.spareRound)
  // Unchanged, it stays the very Session it was.
  if (minutes === session.minutes && spare === session.spareRound && blocks.every((b, i) => b === session.blocks[i])) {
    return session
  }
  return { ...session, minutes, blocks, ...(spare && { spareRound: spare }) }
}
