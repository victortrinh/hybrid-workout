import { describe, expect, it } from 'vitest'
import { addDays, isoWeekday } from '../calendar'
import { programStart } from '../coach'
import { describeExercise, SESSION_TYPES, stationLoad } from './describe'
import { program } from './program'
import type { Exercise, Session, Week } from './types'

const weeks: Week[] = program.phases.flatMap((p) => p.weeks)
const weekNumbers = (match: (w: Week) => boolean) => weeks.filter(match).map((w) => w.number)
const byNumber = (n: number) => weeks.find((w) => w.number === n)!
const session = (n: number, id: string) => byNumber(n).sessions.find((s) => s.id === id)!
const exercises = (s: Session): Exercise[] => s.blocks.flatMap((b) => b.exercises)

describe('Program invariants', () => {
  it('has 27 Weeks, numbered in order, each starting on the Monday after the last', () => {
    expect(weeks.map((w) => w.number)).toEqual(Array.from({ length: 27 }, (_, i) => i + 1))
    expect(program.weekCount).toBe(27)
    weeks.forEach((week, i) => {
      expect(isoWeekday(week.startDate)).toBe(1)
      expect(week.startDate).toBe(addDays(programStart(program), 7 * i))
    })
    expect(weeks[0].startDate).toBe('2026-10-19')
  })

  it('puts Race day, Wednesday 21 April 2027, in the last Week', () => {
    expect(program.raceDay).toBe('2027-04-21')
    expect(isoWeekday(program.raceDay)).toBe(3)
    const last = weeks.at(-1)!
    expect(last.race).toBe(true)
    expect(last.startDate).toBe(addDays(program.raceDay, -2))
    expect(last.sessions.find((s) => s.date === program.raceDay)).toMatchObject({ id: 'race', key: true })
    expect(weekNumbers((w) => w.race)).toEqual([27])
  })

  it('groups the Weeks into Phases that cover 1–27 without gaps', () => {
    let next = 1
    for (const phase of program.phases) {
      expect(phase.firstWeek).toBe(next)
      expect(phase.weeks.map((w) => w.number)).toEqual(
        Array.from({ length: phase.lastWeek - phase.firstWeek + 1 }, (_, i) => phase.firstWeek + i),
      )
      next = phase.lastWeek + 1
    }
    expect(next).toBe(28)
  })

  it('has one Key session in every non-Deload Week and none in a Deload', () => {
    for (const week of weeks) {
      const keys = week.sessions.filter((s) => s.key)
      expect({ week: week.number, keys: keys.length }).toEqual({ week: week.number, keys: week.deload ? 0 : 1 })
    }
  })

  it('gives every Session a Session type, a unique id and something to do', () => {
    for (const week of weeks) {
      expect(new Set(week.sessions.map((s) => s.id)).size).toBe(week.sessions.length)
      for (const s of week.sessions) {
        expect(SESSION_TYPES[s.type]).toBeDefined()
        expect(s.blocks.length).toBeGreaterThan(0)
        expect(s.blocks.some((b) => b.main)).toBe(true)
        expect(s.key && s.optional).toBe(false)
      }
    }
  })

  it('never makes an Optional session Key, and keeps Optional sessions to Easy runs', () => {
    for (const s of weeks.flatMap((w) => w.sessions).filter((s) => s.optional)) {
      expect(s.type).toBe('easy')
    }
  })

  it('holds the Bucket of Speed, Strength, Threshold, HYROX and an Optional Easy run until the Taper', () => {
    for (const week of weeks.filter((w) => w.number <= 25)) {
      const lanes = week.sessions.map((s) => SESSION_TYPES[s.type].lane)
      const expected = week.deload
        ? ['speed', 'strength', 'easy', 'hyrox', 'easy']
        : ['speed', 'strength', 'threshold', 'hyrox', 'easy']
      expect({ week: week.number, lanes }).toEqual({ week: week.number, lanes: expected })
      expect(week.sessions.at(-1)!.optional).toBe(true)
    }
  })
})

describe('the plan’s marked Weeks', () => {
  it('deloads Weeks 4, 8, 12, 16 and 22, with Threshold swapped for easy running', () => {
    expect(weekNumbers((w) => w.deload)).toEqual([4, 8, 12, 16, 22])
    for (const n of [4, 8, 12, 16, 22]) {
      expect(byNumber(n).sessions.some((s) => s.type === 'threshold')).toBe(false)
      expect(session(n, 'speed').headline).toBe('4 × 2′ controlled')
      expect(session(n, 'hyrox').headline).toBe('technique circuit')
    }
  })

  it('tests the 5K in Weeks 2, 9, 17 and 25, in place of Speed', () => {
    expect(weekNumbers((w) => w.fiveKTest)).toEqual([2, 9, 17, 25])
    for (const n of [2, 9, 17, 25]) {
      const week = byNumber(n)
      expect(week.sessions.some((s) => s.type === 'speed')).toBe(false)
      expect(session(n, '5k-test')).toMatchObject({ key: true })
    }
    expect(session(2, '5k-test').headline).toBe('baseline')
    expect(session(25, '5k-test').headline).toBe('final')
  })

  it('simulates the race in Weeks 18, 21 and 24, in place of HYROX', () => {
    expect(weekNumbers((w) => w.raceSimulation)).toEqual([18, 21, 24])
    for (const n of [18, 21, 24]) {
      expect(byNumber(n).sessions.some((s) => s.type === 'hyrox')).toBe(false)
      expect(session(n, 'race-simulation').key).toBe(true)
    }
  })

  it('runs half simulation A over Stations 1–4 and B over 5–8, at race volume', () => {
    const stationsOf = (n: number) =>
      exercises(session(n, 'race-simulation')).flatMap((e) =>
        e.prescription.kind === 'station' ? [[e.prescription.station, e.prescription.meters ?? e.prescription.reps]] : [],
      )
    expect(stationsOf(18)).toEqual([
      ['skierg', 1000],
      ['sled-push', 50],
      ['sled-pull', 50],
      ['burpee-broad-jumps', 80],
    ])
    expect(stationsOf(21)).toEqual([
      ['row', 1000],
      ['farmers-carry', 200],
      ['sandbag-lunges', 100],
      ['wall-balls', 100],
    ])
  })

  it('runs Week 24 as eight full 1 km runs with every Station at half race volume and Race load', () => {
    const sim = session(24, 'race-simulation')
    const main = sim.blocks.filter((b) => b.main)
    expect(main).toHaveLength(8)
    for (const block of main) {
      const [run, station] = block.exercises.map((e) => e.prescription)
      expect(run).toMatchObject({ kind: 'run', meters: 1000 })
      expect(station.kind).toBe('station')
      if (station.kind !== 'station') continue
      const race = program.stations[station.station].raceLoad
      expect(station.meters ?? station.reps).toBe((race.meters ?? race.reps!) / 2)
      if (race.pounds !== undefined && !race.fixedLoad) expect(station.raceLoadPercent).toBe(100)
    }
    expect(main.map((b) => b.exercises[1].name)).toEqual([
      'SkiErg',
      'Sled push',
      'Sled pull',
      'Burpee broad jumps',
      'Row',
      'Farmers carry',
      'Sandbag lunges',
      'Wall balls',
    ])
  })

  it('tapers in Week 26 with no Threshold and no HYROX circuit, then races in Week 27', () => {
    const taper = byNumber(26)
    expect(taper.sessions.map((s) => s.type)).toEqual(['speed', 'strength', 'easy', 'easy', 'easy'])
    expect(taper.sessions.filter((s) => !s.optional).map((s) => s.id)).toEqual(['speed', 'strength', 'easy-strides'])
    expect(byNumber(27).sessions.map((s) => s.id)).toEqual(['shakeout', 'race'])
  })

  it('grows the Easy run into a 60-minute long run by Week 23', () => {
    expect(session(23, 'easy').minutes).toBe(60)
    expect(Math.max(...weeks.flatMap((w) => w.sessions).filter((s) => s.type === 'easy').map((s) => s.minutes))).toBe(60)
  })
})

describe('Race loads and Substitutions', () => {
  it('holds the Men’s Open Race loads in pounds, with sled loads as plate weight', () => {
    const { stations } = program
    expect(stations['sled-push'].raceLoad).toEqual({ meters: 50, pounds: 335 })
    expect(stations['sled-pull'].raceLoad).toEqual({ meters: 50, pounds: 227 })
    expect(stations['farmers-carry'].raceLoad).toEqual({ meters: 200, pounds: 53, implements: 2 })
    expect(stations['sandbag-lunges'].raceLoad).toEqual({ meters: 100, pounds: 44 })
    expect(stations['wall-balls'].raceLoad).toEqual({ reps: 100, pounds: 13, fixedLoad: true })
  })

  it('rounds every Station load to the nearest 5 lb, Race load included, and never scales the wall ball', () => {
    const { stations } = program
    expect(stationLoad(stations['sled-push'], 60)).toBe('200 lb plates')
    expect(stationLoad(stations['sled-pull'], 60)).toBe('135 lb plates')
    expect(stationLoad(stations['farmers-carry'], 60)).toBe('2 × 30 lb')
    expect(stationLoad(stations['farmers-carry'])).toBe('2 × 55 lb')
    expect(stationLoad(stations['wall-balls'], 60)).toBe('13 lb ball')
    expect(stationLoad(stations.skierg)).toBe('')
  })

  it('offers sled or bike sprints for every jump and acceleration', () => {
    for (const s of weeks.flatMap((w) => w.sessions).filter((s) => s.type === 'speed')) {
      for (const e of exercises(s).filter((e) => /jumps|Accelerations/.test(e.name))) {
        expect(e.substitutions?.[0].options.map((o) => o.name)).toEqual(['Sled push sprints', 'Bike sprints'])
      }
    }
  })
})

describe('describeExercise', () => {
  const line = (n: number, id: string, name: string, nth = 0) =>
    describeExercise(exercises(session(n, id)).filter((e) => e.name === name)[nth], program.stations)

  it('reads Stations with distance and pounds', () => {
    expect(line(1, 'hyrox', 'Sled push').detail).toBe('25 m · 200 lb plates · 60% of Race load')
    expect(line(21, 'race-simulation', 'Farmers carry').detail).toBe('200 m · 2 × 55 lb')
    expect(line(2, 'hyrox', 'Wall balls').detail).toBe('20 reps · 13 lb ball')
  })

  it('reads lifts, Deload lifts and Substitutions', () => {
    expect(line(2, 'strength', 'Back squat').detail).toBe('3 × 5 · RPE 7 · 90–120″ rest')
    expect(line(15, 'strength', 'Back squat').detail).toBe('2 × 4 · RPE 7–8 · 90–120″ rest')
    expect(line(4, 'strength', 'Back squat').detail).toBe('2 × 5 · 85–90% of Working weight · RPE ≤ 6 · 90–120″ rest')
    expect(line(3, 'speed', 'Accelerations')).toMatchObject({
      detail: '4 × 15 m · 80–90% of max',
      substitutions: ['No floor space or Readiness says no jumps: Sled push sprints 10–15 m, light, or Bike sprints 8–10″'],
    })
  })

  it('reads intervals with their pace and recovery', () => {
    expect(line(14, 'speed', 'Intervals').detail).toBe('6 × 2′ / 90″ jog · 5K effort −5 s/km')
    expect(line(7, 'threshold', 'Threshold reps').detail).toBe('3 × 8′ / 90″ jog · Threshold effort, RPE 6–7')
  })
})
