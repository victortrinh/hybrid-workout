import { describe, expect, it } from 'vitest'
import { localDate } from './calendar'
import type { LoggedStatus, SessionLog, StationLog } from './log'
import { program } from './program/program'
import type { StationId } from './program/types'
import { racePlan, ROXZONE_SECONDS, showsRacePlan } from './racePlan'

let n = 0
function simulation(
  week: number,
  date: string,
  stations: StationLog[],
  status: LoggedStatus = 'done',
): SessionLog {
  n += 1
  return {
    id: `sim-${n}`,
    week,
    sessionId: 'race-simulation',
    date: localDate(date),
    status,
    minutes: 65,
    rpe: 9,
    notes: null,
    resultSeconds: null,
    environment: 'indoor',
    distanceMeters: null,
    intervals: [],
    sets: [],
    stations,
    updatedAt: `${date}T20:00:00.000Z`,
  }
}

const run = (round: number, seconds: number | null, meters = 1000): StationLog => ({
  round,
  part: 'run',
  pounds: null,
  meters,
  reps: null,
  seconds,
})

const station = (round: number, id: StationId, seconds: number | null, volume: { meters?: number; reps?: number } = {}) => {
  const load = program.stations[id].raceLoad
  return {
    round,
    part: id,
    pounds: load.pounds ?? null,
    meters: volume.meters ?? load.meters ?? null,
    reps: volume.reps ?? load.reps ?? null,
    seconds,
  } satisfies StationLog
}

/** Week 17: the first four Stations at full race volume. */
const halfA = (date = '2027-02-20') =>
  simulation(17, date, [
    run(1, 290),
    station(1, 'skierg', 250),
    run(2, 300),
    station(2, 'sled-push', 200),
    run(3, 305),
    station(3, 'sled-pull', 230),
    run(4, 310),
    station(4, 'burpee-broad-jumps', 280),
  ])

/** Week 20: the last four. */
const halfB = (date = '2027-03-13') =>
  simulation(20, date, [
    run(1, 285),
    station(1, 'row', 255),
    run(2, 295),
    station(2, 'farmers-carry', 110),
    run(3, 300),
    station(3, 'sandbag-lunges', 240),
    run(4, 300),
    station(4, 'wall-balls', 330),
  ])

const RACE_EVE = localDate('2027-04-20')

describe('when the race plan shows', () => {
  it('shows the day before Race day and on Race day, not before or after', () => {
    expect(showsRacePlan(2)).toBe(false)
    expect(showsRacePlan(1)).toBe(true)
    expect(showsRacePlan(0)).toBe(true)
    expect(showsRacePlan(-1)).toBe(false)
  })
})

describe('the race plan', () => {
  it('lists the eight Stations in race order with no splits before any Race simulation', () => {
    const plan = racePlan(program, [], RACE_EVE)
    expect(plan.legs.map((l) => l.station)).toEqual([
      'skierg',
      'sled-push',
      'sled-pull',
      'burpee-broad-jumps',
      'row',
      'farmers-carry',
      'sandbag-lunges',
      'wall-balls',
    ])
    expect(plan.legs.every((l) => l.split === null)).toBe(true)
    expect(plan.run).toBeNull()
    expect(plan.finish).toBeNull()
    expect(plan.simulations).toEqual([])
  })

  it('takes each Station from the Race simulation that timed it, and the run pace from the latest', () => {
    const plan = racePlan(program, [halfA(), halfB()], RACE_EVE)
    expect(plan.legs.map((l) => l.split?.seconds)).toEqual([250, 200, 230, 280, 255, 110, 240, 330])
    expect(plan.legs[0].split).toEqual({ seconds: 250, week: 17, scaled: false })
    expect(plan.legs[7].split).toEqual({ seconds: 330, week: 20, scaled: false })
    // Week 20's four 1 km runs: 285, 295, 300, 300.
    expect(plan.run).toEqual({ secondsPerKm: 295, week: 20 })
    expect(plan.simulations).toEqual([17, 20])
  })

  it('estimates the finish: eight runs at the pace, every Station, and the Roxzone', () => {
    const plan = racePlan(program, [halfA(), halfB()], RACE_EVE)
    const stations = 250 + 200 + 230 + 280 + 255 + 110 + 240 + 330
    expect(plan.finish).toBe(8 * 295 + stations + ROXZONE_SECONDS)
  })

  it('has no finish estimate while a Station has no split', () => {
    const plan = racePlan(program, [halfA()], RACE_EVE)
    expect(plan.legs.slice(4).every((l) => l.split === null)).toBe(true)
    expect(plan.run).toEqual({ secondsPerKm: 301, week: 17 })
    expect(plan.finish).toBeNull()
  })

  it('doubles a half-volume split, but a full-volume one wins', () => {
    const fullRun = simulation(23, '2027-04-03', [
      run(1, 280),
      station(1, 'skierg', 120, { meters: 500 }),
      run(2, 282),
      station(2, 'sled-push', 90, { meters: 25 }),
      run(3, 284),
      station(3, 'sled-pull', 100, { meters: 25 }),
      run(4, 286),
      station(4, 'burpee-broad-jumps', 130, { meters: 40 }),
      run(5, 288),
      station(5, 'row', 125, { meters: 500 }),
      run(6, 290),
      station(6, 'farmers-carry', 50, { meters: 100 }),
      run(7, 292),
      station(7, 'sandbag-lunges', 115, { meters: 50 }),
      run(8, 294),
      station(8, 'wall-balls', 150, { reps: 50 }),
    ])
    const onlyFullRun = racePlan(program, [fullRun], RACE_EVE)
    expect(onlyFullRun.legs[0].split).toEqual({ seconds: 240, week: 23, scaled: true })
    expect(onlyFullRun.legs[7].split).toEqual({ seconds: 300, week: 23, scaled: true })
    expect(onlyFullRun.run).toEqual({ secondsPerKm: 287, week: 23 })

    const all = racePlan(program, [halfA(), halfB(), fullRun], RACE_EVE)
    expect(all.legs[0].split).toEqual({ seconds: 250, week: 17, scaled: false })
    // The latest Race simulation sets the run pace, whatever its Station volume.
    expect(all.run).toEqual({ secondsPerKm: 287, week: 23 })
    expect(all.simulations).toEqual([17, 20, 23])
  })

  it('reads only the latest edit of a Race simulation log', () => {
    const again = simulation(17, '2027-02-27', [run(1, 280), station(1, 'skierg', 240)])
    // A later edit of the same log replaces it.
    const plan = racePlan(program, [halfA(), { ...again, id: 'sim-edit', updatedAt: '2027-02-28T20:00:00.000Z' }], RACE_EVE)
    expect(plan.legs[0].split).toEqual({ seconds: 240, week: 17, scaled: false })
    expect(plan.legs[1].split).toBeNull()
  })

  it('leaves out Skipped Race simulations and splits not timed', () => {
    const skipped = simulation(17, '2027-02-20', [run(1, 290), station(1, 'skierg', 250)], 'skipped')
    expect(racePlan(program, [skipped], RACE_EVE).legs[0].split).toBeNull()
    const untimed = simulation(17, '2027-02-20', [run(1, null), station(1, 'skierg', null)])
    const plan = racePlan(program, [untimed], RACE_EVE)
    expect(plan.legs[0].split).toBeNull()
    expect(plan.run).toBeNull()
    expect(plan.simulations).toEqual([])
  })

  it('ignores HYROX sessions: a round is not a Station split', () => {
    const hyrox = { ...simulation(22, '2027-03-25', [station(1, 'sled-push', 200)]), sessionId: 'hyrox' }
    expect(racePlan(program, [hyrox], RACE_EVE).legs[1].split).toBeNull()
  })
})
