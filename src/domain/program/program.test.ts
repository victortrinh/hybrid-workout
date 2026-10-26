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
  it('has 26 Weeks, numbered in order, each starting on the Monday after the last', () => {
    expect(weeks.map((w) => w.number)).toEqual(Array.from({ length: 26 }, (_, i) => i + 1))
    expect(program.weekCount).toBe(26)
    weeks.forEach((week, i) => {
      expect(isoWeekday(week.startDate)).toBe(1)
      expect(week.startDate).toBe(addDays(programStart(program), 7 * i))
    })
    expect(weeks[0].startDate).toBe('2026-10-26')
  })

  it('puts Race day, Wednesday 21 April 2027, in the last Week', () => {
    expect(program.raceDay).toBe('2027-04-21')
    expect(isoWeekday(program.raceDay)).toBe(3)
    const last = weeks.at(-1)!
    expect(last.race).toBe(true)
    expect(last.startDate).toBe(addDays(program.raceDay, -2))
    expect(last.sessions.find((s) => s.date === program.raceDay)).toMatchObject({ id: 'race', key: true })
    expect(weekNumbers((w) => w.race)).toEqual([26])
  })

  it('groups the Weeks into Phases that cover 1–26 without gaps', () => {
    let next = 1
    for (const phase of program.phases) {
      expect(phase.firstWeek).toBe(next)
      expect(phase.weeks.map((w) => w.number)).toEqual(
        Array.from({ length: phase.lastWeek - phase.firstWeek + 1 }, (_, i) => phase.firstWeek + i),
      )
      next = phase.lastWeek + 1
    }
    expect(next).toBe(27)
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
    for (const week of weeks.filter((w) => w.number <= 24)) {
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
  it('deloads Weeks 7, 11, 15 and 21, with Threshold swapped for easy running', () => {
    expect(weekNumbers((w) => w.deload)).toEqual([7, 11, 15, 21])
    for (const n of [7, 11, 15, 21]) {
      expect(byNumber(n).sessions.some((s) => s.type === 'threshold')).toBe(false)
      expect(session(n, 'speed').headline).toBe('4 × 2′ controlled')
      expect(session(n, 'hyrox').headline).toBe('technique circuit')
    }
  })

  it('tests the 5K in Weeks 2, 8, 16 and 24, in place of Speed', () => {
    expect(weekNumbers((w) => w.fiveKTest)).toEqual([2, 8, 16, 24])
    for (const n of [2, 8, 16, 24]) {
      const week = byNumber(n)
      expect(week.sessions.some((s) => s.type === 'speed')).toBe(false)
      expect(session(n, '5k-test')).toMatchObject({ key: true })
    }
    expect(session(2, '5k-test').headline).toBe('baseline')
    expect(session(24, '5k-test').headline).toBe('final')
  })

  it('simulates the race in Weeks 17, 20 and 23, in place of HYROX', () => {
    expect(weekNumbers((w) => w.raceSimulation)).toEqual([17, 20, 23])
    for (const n of [17, 20, 23]) {
      expect(byNumber(n).sessions.some((s) => s.type === 'hyrox')).toBe(false)
      expect(session(n, 'race-simulation').key).toBe(true)
    }
  })

  it('runs half simulation A over Stations 1–4 and B over 5–8, at race volume', () => {
    const stationsOf = (n: number) =>
      exercises(session(n, 'race-simulation')).flatMap((e) =>
        e.prescription.kind === 'station' ? [[e.prescription.station, e.prescription.meters ?? e.prescription.reps]] : [],
      )
    expect(stationsOf(17)).toEqual([
      ['skierg', 1000],
      ['sled-push', 50],
      ['sled-pull', 50],
      ['burpee-broad-jumps', 80],
    ])
    expect(stationsOf(20)).toEqual([
      ['row', 1000],
      ['farmers-carry', 200],
      ['sandbag-lunges', 100],
      ['wall-balls', 100],
    ])
  })

  it('runs Week 23 as eight full 1 km runs with every Station at half race volume and Race load', () => {
    const sim = session(23, 'race-simulation')
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

  it('tapers in Week 25 with no Threshold and a short Station touch, then races in Week 26', () => {
    const taper = byNumber(25)
    expect(taper.sessions.map((s) => s.type)).toEqual(['speed', 'strength', 'easy', 'hyrox', 'easy'])
    expect(taper.sessions.filter((s) => !s.optional).map((s) => s.id)).toEqual(['speed', 'strength', 'easy-strides', 'hyrox'])
    const touch = session(25, 'hyrox')
    expect(touch.minutes).toBe(25)
    expect(touch.blocks.filter((b) => b.main).map((b) => b.exercises.map((e) => e.name))).toEqual([
      ['Run', 'Sled push', 'Wall balls'],
      ['Run', 'Sled push', 'Wall balls'],
    ])
    expect(byNumber(26).sessions.map((s) => s.id)).toEqual(['shakeout', 'race'])
  })

  it('grows the Easy run into a 60-minute long run by Week 22', () => {
    expect(session(22, 'easy').minutes).toBe(60)
    expect(Math.max(...weeks.flatMap((w) => w.sessions).filter((s) => s.type === 'easy').map((s) => s.minutes))).toBe(60)
  })
})

describe('warm-ups', () => {
  const all = weeks.flatMap((w) => w.sessions)
  /** The first `n` Blocks, as "name minutes′: exercise, exercise". */
  const warmUp = (s: Session, n = 2) =>
    s.blocks
      .slice(0, n)
      .map((b) => `${b.name} ${b.minutes}′: ${b.exercises.map((e) => describeExercise(e, program.stations)).map((l) => `${l.name} ${l.detail}`.trim()).join(', ')}`)

  it('splits every Speed warm-up, Deload and Taper too, into a 7′ jog and 3′ of Drills to tick', () => {
    const speeds = all.filter((s) => s.type === 'speed')
    expect(speeds.map((s) => s.minutes)).toEqual(expect.arrayContaining([45, 35, 40]))
    for (const s of speeds) {
      expect(warmUp(s)).toEqual([
        'Warm-up 7′: Easy jog 7 min · Easy, RPE 2–4',
        'Drills 3′: Leg swings 10 / leg, A-skips 2 × 20 m, B-skips 2 × 20 m, High knees 20 m, Butt kicks 20 m',
      ])
    }
  })

  it('splits the 5K test warm-up into a 10′ jog and 2′ of Strides', () => {
    for (const s of all.filter((s) => s.type === '5k-test')) {
      expect(warmUp(s)).toEqual(['Warm-up 10′: Easy jog 10 min · Easy, RPE 2–4', 'Strides 2′: Strides 4 × 15″'])
    }
  })

  it('splits the HYROX warm-up into a 5′ jog and 2′ of Lunges, with nothing left in a note', () => {
    const circuits = all.filter((s) => s.id === 'hyrox')
    expect(circuits).toHaveLength(22)
    for (const s of circuits) {
      expect(warmUp(s)).toEqual(['Warm-up 5′: Easy jog 5 min · Easy, RPE 2–4', 'Lunges 2′: Lunges 2 × 10'])
    }
  })

  it('leaves Threshold, the Easy run and the Race simulation as they were', () => {
    expect(warmUp(session(3, 'threshold'), 1)).toEqual(['Warm-up 10′: Easy jog 10 min · Easy, RPE 2–4'])
    expect(session(3, 'easy').blocks.map((b) => b.name)).toEqual(['Easy run'])
    expect(warmUp(session(17, 'race-simulation'), 1)).toEqual(['Warm-up 10′: Easy jog 7 min · Easy, RPE 2–4, Station prep'])
  })
})

describe('HYROX Set up', () => {
  const setUp = (n: number) => session(n, 'hyrox').blocks.find((b) => b.setup)!
  const loads = (n: number) => setUp(n).exercises.map((e) => describeExercise(e, program.stations)).map((l) => `${l.name}: ${l.detail}`)

  it('comes right before round 1, untimed, so it’s in neither the minutes nor the Training load', () => {
    const blocks = session(1, 'hyrox').blocks
    expect(blocks.map((b) => [b.name, b.minutes])).toEqual([
      ['Warm-up', 5],
      ['Lunges', 2],
      ['Set up', undefined],
      ['Round 1', 11],
      ['Round 2', 11],
      ['Round 3', 11],
      ['Cooldown', 5],
    ])
    expect(session(1, 'hyrox').minutes).toBe(45)
  })

  it('lists every Station the Session loads once, in the order they come up, with its load', () => {
    expect(loads(1)).toEqual([
      'Sled push: 200 lb plates · 60% of Race load',
      'Sled pull: 135 lb plates · 60% of Race load',
      'Farmers carry: 2 × 30 lb · 60% of Race load',
      'Sandbag lunges: 25 lb · 60% of Race load',
    ])
    expect(loads(2)).toEqual(['Wall balls: 13 lb ball'])
    expect(loads(22)).toEqual(['Sled push: 335 lb plates', 'Sled pull: 225 lb plates', 'Sandbag lunges: 45 lb'])
  })

  it('leaves out the Stations with nothing to load, and says so once', () => {
    expect(setUp(1).note).toBeUndefined()
    expect(setUp(2).note).toBe('Nothing else to load.')
    const all = weeks.flatMap((w) => w.sessions).filter((s) => s.id === 'hyrox')
    const loaded = all.flatMap((s) => s.blocks.filter((b) => b.setup)).flatMap((b) => b.exercises)
    expect(loaded.map((e) => describeExercise(e, program.stations).detail).filter((d) => !d)).toEqual([])
    expect(all.every((s) => s.blocks.some((b) => b.setup && b.exercises.length > 0))).toBe(true)
  })

  it('is in every HYROX circuit, and in no other Session', () => {
    const all = weeks.flatMap((w) => w.sessions)
    expect(all.filter((s) => s.blocks.some((b) => b.setup)).every((s) => s.id === 'hyrox')).toBe(true)
    expect(all.filter((s) => s.id === 'hyrox').every((s) => s.blocks.some((b) => b.setup))).toBe(true)
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
    expect(line(1, 'hyrox', 'Sled push', 1).detail).toBe('25 m · 200 lb plates · 60% of Race load')
    expect(line(20, 'race-simulation', 'Farmers carry').detail).toBe('200 m · 2 × 55 lb')
    expect(line(2, 'hyrox', 'Wall balls', 1).detail).toBe('20 reps · 13 lb ball')
  })

  it('reads lifts, Deload lifts and Substitutions', () => {
    expect(line(2, 'strength', 'Back squat').detail).toBe('3 × 5 · RPE 7 · 90–120″ rest')
    expect(line(14, 'strength', 'Back squat').detail).toBe('2 × 4 · RPE 7–8 · 90–120″ rest')
    expect(line(7, 'strength', 'Back squat').detail).toBe('2 × 5 · 85–90% of Working weight · RPE ≤ 6 · 90–120″ rest')
    expect(line(3, 'speed', 'Accelerations')).toMatchObject({
      detail: '4 × 15 m · 80–90% of max · 45″ rest',
      substitutions: ['No floor space or Readiness says no jumps: Sled push sprints 10–15 m, light, or Bike sprints 8–10″'],
    })
  })

  it('reads intervals with their pace and recovery', () => {
    expect(line(13, 'speed', 'Intervals').detail).toBe('6 × 2′ / 90″ jog · 5K effort −5 s/km')
    expect(line(6, 'threshold', 'Threshold reps').detail).toBe('3 × 8′ / 90″ jog · Threshold effort, RPE 6–7')
  })
})
