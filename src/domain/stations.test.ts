import { describe, expect, it } from 'vitest'
import { addDays, localDate } from './calendar'
import { coach, findWeek, prescribedWeek } from './coach'
import { liveBlocks } from './live'
import type { SessionLog, StationLog } from './log'
import { stationPounds } from './program/describe'
import { program, stations } from './program/program'
import type { Session, StationId, Week } from './program/types'
import { trainingPaces } from './paces'
import { DEFAULT_RACE_RUN } from './program/hyroxMinutes'
import { hyroxMinutes, stationBest, stationEstimate, stationRules, stationTarget } from './stations'

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

  it('counts Sessions, not rounds: two rounds of a Station in one easy Session are one log', () => {
    const twice = (week: number, date: string, rpe: number, first: number, second: number) =>
      log(week, 'hyrox-b', date, rpe, [
        { ...at('skierg', first, SKI), round: 1 },
        { ...at('skierg', second, SKI), round: 5 },
      ])
    const one = [twice(1, '2026-11-10', 6, 62, 60)]
    expect(stationTarget(one, 'skierg', SKI)).toBeNull()
    // The Station best can come from any round.
    expect(stationBest(one, 'skierg', SKI)).toBe(60)
    // A harder Session before an easy one: the last two Sessions weren't both RPE 7 or under.
    const hardThenEasy = [twice(1, '2026-11-10', 9, 62, 60), twice(2, '2026-11-17', 6, 63, 61)]
    expect(stationTarget(hardThenEasy, 'skierg', SKI)).toBe(60)
    const easyTwice = [twice(1, '2026-11-10', 7, 62, 60), twice(2, '2026-11-17', 6, 63, 61)]
    expect(stationTarget(easyTwice, 'skierg', SKI)).toBe(58)
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
    const once = [
      ['skierg', 59],
      ['burpee-broad-jumps', 50],
      ['row', 55],
      ['wall-balls', 70],
    ]
    expect(targets(session(week(3, logs), 'hyrox-b'))).toEqual([...once, ...once])
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
  it('drops the row in B when nothing is logged yet, going through the other three twice', () => {
    expect(roundStations(session(week(5, []), 'hyrox-b'))).toEqual([
      'skierg',
      'burpee-broad-jumps',
      'wall-balls',
      'skierg',
      'burpee-broad-jumps',
      'wall-balls',
    ])
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
    expect(roundStations(b)).toEqual(['skierg', 'burpee-broad-jumps', 'row', 'skierg', 'burpee-broad-jumps', 'row'])
    expect(b.blocks.filter((bl) => bl.main).map((bl) => bl.name)).toEqual(['Round 1', 'Round 2', 'Round 3', 'Round 4', 'Round 5', 'Round 6'])
    expect(b.headline).toBe('6 rounds')
    expect(b.spareRound).toMatchObject({ name: 'Round 6', exercises: [{ name: 'Wall balls' }, { name: 'Run' }] })
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
    expect(roundStations(session(week(5, [a(4, '2026-12-02', 40)]), 'hyrox-a'))).toEqual(
      ['sled-push', 'sled-pull', 'sandbag-lunges', 'sled-push', 'sled-pull', 'sandbag-lunges'],
    )
    // A slower carry: the sled push, first in race order of those at their best, goes instead.
    const logs = [a(3, '2026-11-25', 40), a(4, '2026-12-02', 45)]
    const s = session(week(5, logs), 'hyrox-a')
    expect(roundStations(s)).toEqual(['sled-pull', 'farmers-carry', 'sandbag-lunges', 'sled-pull', 'farmers-carry', 'sandbag-lunges'])
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
    expect(liveBlocks(b).filter((block) => block.kind === 'round')).toHaveLength(8)
  })
})

describe('Station estimate', () => {
  it('is the Station best at that volume when there is one', () => {
    const logs = [log(1, 'hyrox-b', '2026-11-10', 8, [at('skierg', 62, SKI)]), log(2, 'hyrox-b', '2026-11-17', 8, [at('skierg', 58, SKI)])]
    expect(stationEstimate(logs, 'skierg', SKI)).toBe(58)
  })

  it('scales the best at the nearest other volume by share without one', () => {
    const logs = [
      log(1, 'hyrox-b', '2026-11-10', 8, [at('skierg', 60, SKI)]),
      log(6, 'hyrox-b', '2026-12-15', 8, [at('skierg', 130, { meters: 500 }), at('skierg', 125, { meters: 500 })]),
    ]
    // 750 m is nearest 500 m: 125 ÷ (500 / 750).
    expect(stationEstimate(logs, 'skierg', { meters: 750 })).toBe(188)
    // Race volume, by reps as well as meters.
    const balls = [log(1, 'hyrox-b', '2026-11-10', 8, [at('wall-balls', 80, { reps: 25 })])]
    expect(stationEstimate(balls, 'wall-balls', { reps: 100 })).toBe(320)
  })

  it('falls back to the fixed default with no log at Race load at any volume', () => {
    const light = [log(1, 'hyrox-a', '2026-11-10', 8, [at('sled-push', 40, { meters: 25 }, 100)])]
    // Half of the 180 s race-volume default.
    expect(stationEstimate(light, 'sled-push', { meters: 25 })).toBe(90)
    expect(stationEstimate([], 'wall-balls', { reps: 50 })).toBe(180)
  })
})

describe('HYROX minutes from the logs', () => {
  const week = (n: number) => findWeek(program, n)!
  const minutes = (w: Week, id: string) => w.sessions.find((s) => s.id === id)!.minutes

  it('use the Station bests of the Weeks before, at the Race run pace', () => {
    // Week 11's HYROX A at 5:15/km and the defaults is 40 minutes; much quicker Stations take it to 35.
    expect(minutes(hyroxMinutes(week(11), [], null), 'hyrox-a')).toBe(40)
    const quick = log(10, 'hyrox-a', '2027-01-26', 8, [
      at('sled-push', 60, { meters: 50 }),
      at('sled-pull', 70, { meters: 50 }),
      at('farmers-carry', 60, { meters: 200 }),
      at('sandbag-lunges', 90, { meters: 75 }),
    ])
    expect(minutes(hyroxMinutes(week(11), [quick], null), 'hyrox-a')).toBe(35)
    // Its own Week's log never moves them.
    expect(minutes(hyroxMinutes(week(11), [{ ...quick, week: 11 }], null), 'hyrox-a')).toBe(40)
  })

  it('go by the Training paces, the Program’s default pace without them', () => {
    expect(minutes(hyroxMinutes(week(1), [], trainingPaces(DEFAULT_RACE_RUN)), 'hyrox-a')).toBe(35)
    expect(minutes(hyroxMinutes(week(1), [], trainingPaces(400)), 'hyrox-a')).toBe(40)
    // Nothing but HYROX changes.
    const slow = hyroxMinutes(week(1), [], trainingPaces(400))
    expect(slow.sessions.filter((s) => s.type !== 'hyrox')).toEqual(week(1).sessions.filter((s) => s.type !== 'hyrox'))
  })

  it('update once a Compromised run test sets a new Race run pace', () => {
    const today = localDate('2026-11-25')
    const hyroxA = (logs: SessionLog[]) => coach({ program, today, logs }).week!.sessions.find((s) => s.id === 'hyrox-a')!
    expect(hyroxA([]).minutes).toBe(35)
    // Week 2's test at 6:40/km: 8 × 400 m runs take over five minutes longer.
    const run = (round: number): StationLog => ({ round, part: 'run', pounds: null, meters: 1000, reps: null, seconds: 400 })
    const test = log(2, 'compromised-run-test', '2026-11-18', 8, [1, 2, 3, 4].map(run))
    expect(hyroxA([test]).minutes).toBe(40)
    // A Week shown elsewhere goes by the same paces.
    const paces = coach({ program, today, logs: [test] }).paces
    expect(minutes(prescribedWeek(program, 3, [test], [], undefined, null, paces)!, 'hyrox-a')).toBe(40)
  })
})
