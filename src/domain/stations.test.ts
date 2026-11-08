import { describe, expect, it } from 'vitest'
import { addDays, localDate } from './calendar'
import { findWeek, prescribedWeek } from './coach'
import { liveBlocks } from './live'
import type { SessionLog, StationLog } from './log'
import { stationPounds } from './program/describe'
import { program, stations } from './program/program'
import type { Session, StationId, Week } from './program/types'
import { fade, stationBest, stationRules, stationTarget } from './stations'

let n = 0
const log = (week: number, sessionId: string, date: string, rpe: number | null, lines: StationLog[]): SessionLog => ({
  id: `log-${String(++n).padStart(8, '0')}`,
  week,
  sessionId,
  date: localDate(date),
  status: 'done',
  minutes: 45,
  rpe,
  notes: null,
  resultSeconds: null,
  environment: 'indoor',
  distanceMeters: null,
  recoveryPace: null,
  intervals: [],
  sets: [],
  stations: lines,
  updatedAt: `${date}T18:00:00.000Z`,
})

const RACE = (id: StationId) => stationPounds(stations[id])

/** One Station's line at Race load. */
const at = (
  id: StationId,
  seconds: number | null,
  volume: { meters?: number; reps?: number },
  pounds = RACE(id),
): StationLog => ({
  round: 1,
  part: id,
  pounds,
  meters: volume.meters ?? null,
  reps: volume.reps ?? null,
  seconds,
})

const run = (round: number, meters: number, seconds: number | null): StationLog => ({
  round,
  part: 'run',
  pounds: null,
  meters,
  reps: null,
  seconds,
})

const SKI = { meters: 250 }

describe('Station best', () => {
  it('is the fastest time logged for a Station at that Station volume, at Race load', () => {
    const logs = [
      log(1, 'hyrox-b', '2026-11-10', 8, [at('skierg', 62, SKI)]),
      log(2, 'hyrox-b', '2026-11-17', 8, [at('skierg', 58, SKI)]),
      log(3, 'hyrox-b', '2026-11-24', 8, [at('skierg', 60, SKI)]),
    ]
    expect(stationBest(logs, 'skierg', SKI)).toBe(58)
  })

  it('leaves out other volumes, lighter loads, untimed lines and Sessions not trained', () => {
    const logs = [
      log(1, 'hyrox-b', '2026-11-10', 8, [at('skierg', 120, { meters: 500 })]),
      log(1, 'hyrox-a', '2026-11-11', 8, [at('sled-push', 30, { meters: 25 }, 225)]),
      log(2, 'hyrox-a', '2026-11-18', 8, [at('sled-push', null, { meters: 25 })]),
      {
        ...log(3, 'hyrox-a', '2026-11-25', 8, [at('sled-push', 20, { meters: 25 })]),
        status: 'skipped' as const,
      },
      log(4, 'hyrox-a', '2026-12-02', 8, [at('sled-push', 41, { meters: 25 })]),
    ]
    expect(stationBest(logs, 'skierg', SKI)).toBeNull()
    expect(stationBest(logs, 'sled-push', { meters: 25 })).toBe(41)
  })

  it('counts a Station with nothing to load at any load', () => {
    expect(stationBest([log(1, 'hyrox-b', '2026-11-10', 8, [at('row', 55, SKI, null)])], 'row', SKI)).toBe(55)
  })
})

describe('Station target', () => {
  it('shows none until the Station has two logs at its volume', () => {
    const one = [log(1, 'hyrox-b', '2026-11-10', 6, [at('skierg', 60, SKI)])]
    expect(stationTarget(one, 'skierg', SKI)).toBeNull()
    expect(stationTarget([...one, log(2, 'hyrox-b', '2026-11-17', 8, [at('skierg', 62, SKI)])], 'skierg', SKI)).toBe(60)
  })

  it('is the Station best less 3% once the last two logs at that volume came in at RPE 7 or under', () => {
    const logs = [
      log(1, 'hyrox-b', '2026-11-10', 9, [at('skierg', 60, SKI)]),
      log(2, 'hyrox-b', '2026-11-17', 7, [at('skierg', 62, SKI)]),
      log(3, 'hyrox-b', '2026-11-24', 6, [at('skierg', 61, SKI)]),
    ]
    // 60 × 0.97 = 58.2, to the second.
    expect(stationTarget(logs, 'skierg', SKI)).toBe(58)
  })

  it('stays the Station best when either of the last two was harder than RPE 7', () => {
    const logs = [
      log(1, 'hyrox-b', '2026-11-10', 6, [at('skierg', 60, SKI)]),
      log(2, 'hyrox-b', '2026-11-17', 6, [at('skierg', 62, SKI)]),
      log(3, 'hyrox-b', '2026-11-24', 8, [at('skierg', 61, SKI)]),
    ]
    expect(stationTarget(logs, 'skierg', SKI)).toBe(60)
  })
})

describe('Fade', () => {
  it('is the last run’s pace minus the first’s, in seconds per km', () => {
    const lines = [run(1, 400, 100), at('skierg', 60, SKI), run(2, 400, 104), run(3, 400, 106), run(4, 400, 108)]
    // 250 s/km, then 270 s/km.
    expect(fade(log(1, 'hyrox-b', '2026-11-10', 8, lines))).toBe(20)
  })

  it('reads a run that got faster as a negative Fade', () => {
    expect(fade(log(16, 'race-simulation', '2027-02-24', 8, [run(1, 1000, 300), run(2, 1000, 290)]))).toBe(-10)
  })

  it('needs two timed runs', () => {
    expect(fade(log(1, 'hyrox-b', '2026-11-10', 8, [run(1, 400, 100), run(2, 400, null)]))).toBeNull()
  })
})

/** The Week as the Coach prescribes it, given these logs. */
const week = (number: number, logs: SessionLog[]): Week => stationRules(program, findWeek(program, number)!, logs)
const session = (w: Week, id: string): Session => w.sessions.find((s) => s.id === id)!
const targets = (s: Session) =>
  s.blocks
    .filter((b) => !b.setup)
    .flatMap((b) =>
      b.exercises.flatMap((e) =>
        e.prescription.kind === 'station' ? [[e.prescription.station, e.prescription.target ?? null]] : [],
      ),
    )
const roundStations = (s: Session) =>
  s.blocks
    .filter((b) => b.main)
    .flatMap((b) => b.exercises.flatMap((e) => (e.prescription.kind === 'station' ? [e.prescription.station] : [])))

/** HYROX B's four Stations in a Week, at Foundation volume. */
const hyroxB = (w: number, date: string, rpe: number, seconds: Partial<Record<StationId, number>>) =>
  log(w, 'hyrox-b', date, rpe, [
    at('skierg', seconds.skierg ?? 60, { meters: 250 }),
    at('burpee-broad-jumps', seconds['burpee-broad-jumps'] ?? 50, {
      meters: 20,
    }),
    at('row', seconds.row ?? 55, { meters: 250 }),
    at('wall-balls', seconds['wall-balls'] ?? 70, { reps: 25 }),
  ])

describe('Station targets in the Prescription', () => {
  it('give every HYROX round its Station target once the Station has two logs at its volume', () => {
    const logs = [hyroxB(1, '2026-11-11', 8, { skierg: 61 }), hyroxB(2, '2026-11-18', 8, { skierg: 59 })]
    expect(targets(session(week(3, logs), 'hyrox-b'))).toEqual([
      ['skierg', 59],
      ['burpee-broad-jumps', 50],
      ['row', 55],
      ['wall-balls', 70],
    ])
    expect(targets(session(week(3, logs), 'hyrox-a')).every(([, t]) => t === null)).toBe(true)
  })

  it('count only the Weeks before: a Session’s own log doesn’t move its target', () => {
    const logs = [hyroxB(1, '2026-11-11', 8, {}), hyroxB(2, '2026-11-18', 8, { skierg: 50 })]
    expect(targets(session(week(2, logs), 'hyrox-b')).every(([, t]) => t === null)).toBe(true)
  })

  it('show none in a Deload week or the Taper', () => {
    const logs = [1, 2, 3, 4].map((w) => hyroxB(w, addDays(localDate('2026-11-10'), 7 * (w - 1)), 6, {}))
    expect(targets(session(week(5, logs), 'hyrox-b')).every(([, t]) => t === null)).toBe(true)
    const late = [22, 23].map((w) => week(w, logs))
    expect(late.flatMap((w) => w.sessions.flatMap(targets)).every(([, t]) => t === null)).toBe(true)
  })
})

describe('A Deload HYROX session', () => {
  it('drops the row in B when nothing is logged yet', () => {
    expect(roundStations(session(week(5, []), 'hyrox-b'))).toEqual(['skierg', 'burpee-broad-jumps', 'wall-balls'])
  })

  it('drops the Station the athlete did best last time, keeping race order', () => {
    // Week 4's wall balls matched their best; every other Station came in slower than its best.
    const logs = [
      hyroxB(3, '2026-11-25', 8, {
        skierg: 58,
        'burpee-broad-jumps': 48,
        row: 52,
        'wall-balls': 72,
      }),
      hyroxB(4, '2026-12-02', 8, {
        skierg: 62,
        'burpee-broad-jumps': 50,
        row: 56,
        'wall-balls': 70,
      }),
    ]
    const b = session(week(5, logs), 'hyrox-b')
    expect(roundStations(b)).toEqual(['skierg', 'burpee-broad-jumps', 'row'])
    expect(b.blocks.filter((bl) => bl.main).map((bl) => bl.name)).toEqual(['Round 1', 'Round 2', 'Round 3'])
    expect(b.headline).toBe('3 rounds')
    // Without the wall balls, nothing is left to load: no Set up.
    expect(b.blocks.some((bl) => bl.setup)).toBe(false)
  })
})

describe('A Deload HYROX A', () => {
  it('sets up the Station it swaps in', () => {
    const a = (w: number, date: string, carry: number) =>
      log(w, 'hyrox-a', date, 8, [
        at('sled-push', 60, { meters: 25 }),
        at('sled-pull', 55, { meters: 25 }),
        at('farmers-carry', carry, { meters: 100 }),
        at('sandbag-lunges', 50, { meters: 25 }),
      ])
    // The lunges, sleds and carry all matched their best last time: the carry, the Program's pick, stays dropped.
    expect(roundStations(session(week(5, [a(4, '2026-12-02', 40)]), 'hyrox-a'))).toEqual([
      'sled-push',
      'sled-pull',
      'sandbag-lunges',
    ])
    // A slower carry: the sled push, first in race order of those at their best, goes instead.
    const logs = [a(3, '2026-11-25', 40), a(4, '2026-12-02', 45)]
    const s = session(week(5, logs), 'hyrox-a')
    expect(roundStations(s)).toEqual(['sled-pull', 'farmers-carry', 'sandbag-lunges'])
    expect(s.blocks.find((b) => b.setup)!.exercises.map((e) => e.name)).toEqual(['Sled pull', 'Farmers carry', 'Sandbag lunges'])
  })
})

describe('the Coach’s Prescription', () => {
  it('carries each Station target to the Week as it will be trained and to the Live round clock', () => {
    const logs = [hyroxB(1, '2026-11-11', 6, { row: 56 }), hyroxB(2, '2026-11-18', 7, { row: 54 })]
    const b = prescribedWeek(program, 3, logs, [])!.sessions.find((s) => s.id === 'hyrox-b')!
    const row = liveBlocks(b)
      .flatMap((block) => (block.kind === 'round' ? block.stations : []))
      .find((s) => s.station === 'row')!
    // Both logs at RPE 7 or under: 54 × 0.97 = 52.38.
    expect(row.target).toBe(52)
  })
})
