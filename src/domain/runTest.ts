/**
 * The Compromised run test written after the fact: four rounds of a 1 km run
 * then a Station, logged as the same Station logs Live writes, so Log after
 * and Live give the Coach the same result (src/domain/paces.ts, runTestResult).
 */
import type { SessionLog, StationLog } from './log'
import { stationPounds } from './program/describe'
import { stations } from './program/program'
import type { Session, StationId } from './program/types'

/** One round of the test: the run's distance, then its Station at Race load and half race volume. */
export interface RunTestRound {
  round: number
  runMeters: number
  station: StationId
  meters: number | null
  reps: number | null
  pounds: number | null
}

/** The test's rounds, in order, from its Session. */
export function runTestRounds(session: Session): RunTestRound[] {
  return session.blocks
    .filter((block) => !block.setup && block.exercises.some((e) => e.prescription.kind === 'station'))
    .map((block, i) => {
      const run = block.exercises.find((e) => e.prescription.kind === 'run')?.prescription
      const rx = block.exercises.find((e) => e.prescription.kind === 'station')!.prescription
      if (rx.kind !== 'station') throw new Error('unreachable')
      return {
        round: i + 1,
        runMeters: run && run.kind === 'run' && run.meters ? run.meters : 1000,
        station: rx.station,
        meters: rx.meters ?? null,
        reps: rx.reps ?? null,
        pounds: stationPounds(stations[rx.station]),
      }
    })
}

/** Each round's run split and Station time as typed, in seconds; null where left empty. */
export interface RunTestTimes {
  runs: (number | null)[]
  stations: (number | null)[]
}

/** The times already in a log, to edit; empty for a new one. */
export function runTestTimes(rounds: RunTestRound[], log: SessionLog | null): RunTestTimes {
  const find = (round: number, part: StationLog['part']) =>
    log?.stations.find((line) => line.round === round && line.part === part)?.seconds ?? null
  return {
    runs: rounds.map((r) => find(r.round, 'run')),
    stations: rounds.map((r) => find(r.round, r.station)),
  }
}

/** The Station logs of a test logged after: each round's run, then its Station. None when nothing was timed. */
export function runTestLines(rounds: RunTestRound[], times: RunTestTimes): StationLog[] {
  if ([...times.runs, ...times.stations].every((t) => t === null)) return []
  return rounds.flatMap((r, i): StationLog[] => [
    { round: r.round, part: 'run', pounds: null, meters: r.runMeters, reps: null, seconds: times.runs[i] ?? null },
    { round: r.round, part: r.station, pounds: r.pounds, meters: r.meters, reps: r.reps, seconds: times.stations[i] ?? null },
  ])
}
