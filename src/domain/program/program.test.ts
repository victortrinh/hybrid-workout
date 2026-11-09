import { describe, expect, it } from 'vitest'
import { addDays, isoWeekday } from '../calendar'
import { programStart } from '../coach'
import { describeExercise, describeSession, SESSION_TYPES, stationLoad } from './describe'
import { program } from './program'
import type { Exercise, Session, StationId, Week } from './types'

const weeks: Week[] = program.phases.flatMap((p) => p.weeks)
const weekNumbers = (match: (w: Week) => boolean) => weeks.filter(match).map((w) => w.number)
const byNumber = (n: number) => weeks.find((w) => w.number === n)!
const session = (n: number, id: string) => byNumber(n).sessions.find((s) => s.id === id)!
const exercises = (s: Session): Exercise[] => s.blocks.flatMap((b) => b.exercises)
/** A Session's rounds as "Station volume → run", in order. */
const rounds = (s: Session) =>
  s.blocks
    .filter((b) => b.main)
    .map((b) =>
      b.exercises
        .map(({ prescription: rx }) =>
          rx.kind === 'station' ? `${rx.station} ${rx.meters ?? rx.reps}` : rx.kind === 'run' ? `run ${rx.meters}` : rx.kind,
        )
        .join(' → '),
    )

describe('Program invariants', () => {
  it('has 24 Weeks, numbered in order, from Monday 9 November 2026, each starting on the Monday after the last', () => {
    expect(weeks.map((w) => w.number)).toEqual(Array.from({ length: 24 }, (_, i) => i + 1))
    expect(program.weekCount).toBe(24)
    weeks.forEach((week, i) => {
      expect(isoWeekday(week.startDate)).toBe(1)
      expect(week.startDate).toBe(addDays(programStart(program), 7 * i))
    })
    expect(weeks[0].startDate).toBe('2026-11-09')
  })

  it('puts Race day, Thursday 22 April 2027, in Week 24', () => {
    expect(program.raceDay).toBe('2027-04-22')
    expect(isoWeekday(program.raceDay)).toBe(4)
    const last = weeks.at(-1)!
    expect(last.number).toBe(24)
    expect(last.race).toBe(true)
    expect(last.startDate).toBe('2027-04-19')
    expect(last.sessions.find((s) => s.date === program.raceDay)).toMatchObject({ id: 'race', key: true })
    expect(weekNumbers((w) => w.race)).toEqual([24])
  })

  it('groups the Weeks into Foundation 1–5, Build 6–15, Race specific 16–21 and Taper 22–24, without gaps', () => {
    expect(program.phases.map((p) => [p.name, p.firstWeek, p.lastWeek])).toEqual([
      ['Foundation', 1, 5],
      ['Build', 6, 15],
      ['Race specific', 16, 21],
      ['Taper', 22, 24],
    ])
    let next = 1
    for (const phase of program.phases) {
      expect(phase.firstWeek).toBe(next)
      expect(phase.weeks.map((w) => w.number)).toEqual(
        Array.from({ length: phase.lastWeek - phase.firstWeek + 1 }, (_, i) => phase.firstWeek + i),
      )
      next = phase.lastWeek + 1
    }
    expect(next).toBe(25)
  })

  it('deloads Weeks 5, 10, 15 and 20', () => {
    expect(weekNumbers((w) => w.deload)).toEqual([5, 10, 15, 20])
  })

  it('has one Key session in every non-Deload Week and none in a Deload', () => {
    for (const week of weeks) {
      const keys = week.sessions.filter((s) => s.key)
      expect({ week: week.number, keys: keys.length }).toEqual({ week: week.number, keys: week.deload ? 0 : 1 })
    }
  })

  it('puts the plan’s Key session first: the Run, a test, HYROX A or B, or a Race simulation', () => {
    const key = (n: number) => byNumber(n).sessions.find((s) => s.key)?.id ?? null
    expect(Object.fromEntries(weeks.map((w) => [w.number, key(w.number)]))).toEqual({
      1: 'run',
      2: 'compromised-run-test',
      3: 'hyrox-a',
      4: 'hyrox-b',
      5: null,
      6: 'hyrox-a',
      7: 'hyrox-b',
      8: 'run',
      9: 'compromised-run-test',
      10: null,
      11: 'hyrox-a',
      12: 'hyrox-b',
      13: 'run',
      14: 'compromised-run-test',
      15: null,
      16: 'race-simulation',
      17: 'hyrox-a',
      18: 'race-simulation',
      19: 'compromised-run-test',
      20: null,
      21: 'race-simulation',
      22: 'hyrox-a',
      23: 'run',
      24: 'race',
    })
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

  it('keeps every Optional session to an Easy run, but for Race week’s Station touch', () => {
    for (const s of weeks.flatMap((w) => w.sessions).filter((s) => s.optional && s.id !== 'station-touch')) {
      expect(s.type).toBe('easy')
    }
  })

  it('holds a Bucket of Strength, HYROX B, Run, HYROX A and an Optional Easy run in every Week before Race week', () => {
    for (const week of weeks.filter((w) => !w.race)) {
      const lanes = week.sessions.map((s) => SESSION_TYPES[s.type].lane)
      const run = week.compromisedRunTest ? 'test' : 'run'
      // Build and Race specific also hold the second Easy run, offered after a fully Done Week.
      const second = week.number >= 6 && week.number <= 21
      const easy = second ? ['easy', 'easy'] : ['easy']
      expect({ week: week.number, lanes }).toEqual({ week: week.number, lanes: ['strength', 'hyrox', run, 'hyrox', ...easy] })
      expect(week.sessions.map((s) => s.optional)).toEqual([false, false, false, false, ...easy.map(() => true)])
      expect(week.sessions.map((s) => !!s.afterFullWeek)).toEqual([false, false, false, false, false, ...(second ? [true] : [])])
      // HYROX B the day after Strength spares the legs; HYROX A, the sleds and lunges, waits for the freshest day.
      expect(week.sessions[1].name).toBe('HYROX B')
      if (!week.raceSimulation) expect(week.sessions[3].name).toBe('HYROX A')
    }
  })

  it('keeps every required Session inside the 45-minute Session cap, Set up excluded, but the Race simulations', () => {
    for (const s of weeks.flatMap((w) => w.sessions).filter((s) => !s.date && !s.optional)) {
      if (s.type === 'race-simulation') expect(s.minutes).toBeGreaterThan(45)
      else expect({ id: s.id, minutes: s.minutes <= 45 }).toEqual({ id: s.id, minutes: true })
      const timed = s.blocks.filter((b) => !b.setup && b.minutes !== undefined).reduce((sum, b) => sum + b.minutes!, 0)
      expect(timed).toBeLessThanOrEqual(s.minutes + 0.001)
    }
  })

  it('makes the second Easy run 25 to 30 minutes, never Key', () => {
    const seconds = weeks.flatMap((w) => w.sessions).filter((s) => s.afterFullWeek)
    expect(seconds).toHaveLength(16)
    for (const s of seconds) {
      expect(s).toMatchObject({ id: 'easy-2', type: 'easy', optional: true, key: false, headline: '25–30′' })
      expect(s.minutes).toBeGreaterThanOrEqual(25)
      expect(s.minutes).toBeLessThanOrEqual(30)
    }
  })

  it('has only the HYROX Program’s Session types', () => {
    const types = new Set(weeks.flatMap((w) => w.sessions).map((s) => s.type as string))
    expect([...types].sort()).toEqual(['compromised-run-test', 'easy', 'hyrox', 'race-simulation', 'run', 'strength'])
  })
})

describe('the plan’s marked Weeks', () => {
  it('tests in Weeks 2, 9, 14 and 19 with the Compromised run test, in place of the Run', () => {
    expect(weekNumbers((w) => w.compromisedRunTest)).toEqual([2, 9, 14, 19])
    for (const n of [2, 9, 14, 19]) {
      expect(byNumber(n).sessions.some((s) => s.type === 'run')).toBe(false)
      expect(session(n, 'compromised-run-test')).toMatchObject({ key: true, minutes: 45 })
    }
    expect(session(2, 'compromised-run-test').headline).toBe('baseline')
  })

  it('runs the test as 4 × (1 km at full effort → Station at Race load, half race volume)', () => {
    const test = session(2, 'compromised-run-test')
    expect(rounds(test)).toEqual(['run 1000 → skierg 500', 'run 1000 → sled-push 25', 'run 1000 → row 500', 'run 1000 → wall-balls 50'])
    for (const block of test.blocks.filter((b) => b.main)) {
      expect(block.exercises[0].prescription).toMatchObject({ kind: 'run', effort: { feel: 'all-out' } })
    }
  })

  it('simulates the race in Weeks 16 (half A), 18 (half B) and 21 (full run), in place of HYROX A', () => {
    expect(weekNumbers((w) => w.raceSimulation)).toEqual([16, 18, 21])
    for (const n of [16, 18, 21]) {
      expect(byNumber(n).sessions.some((s) => s.id === 'hyrox-a')).toBe(false)
      expect(session(n, 'race-simulation')).toMatchObject({ key: true })
      expect(session(n, 'hyrox-b').name).toBe('HYROX B')
    }
    expect([16, 18, 21].map((n) => session(n, 'race-simulation').headline)).toEqual(['half A', 'half B', 'full run'])
  })

  it('runs half simulation A over Stations 1–4 and B over 5–8, at race volume', () => {
    const stationsOf = (n: number) =>
      exercises(session(n, 'race-simulation')).flatMap((e) =>
        e.prescription.kind === 'station' ? [[e.prescription.station, e.prescription.meters ?? e.prescription.reps]] : [],
      )
    expect(stationsOf(16)).toEqual([
      ['skierg', 1000],
      ['sled-push', 50],
      ['sled-pull', 50],
      ['burpee-broad-jumps', 80],
    ])
    expect(stationsOf(18)).toEqual([
      ['row', 1000],
      ['farmers-carry', 200],
      ['sandbag-lunges', 100],
      ['wall-balls', 100],
    ])
  })

  it('runs Week 21 as eight 1 km runs with every Station at half race volume', () => {
    expect(rounds(session(21, 'race-simulation'))).toEqual([
      'run 1000 → skierg 500',
      'run 1000 → sled-push 25',
      'run 1000 → sled-pull 25',
      'run 1000 → burpee-broad-jumps 40',
      'run 1000 → row 500',
      'run 1000 → farmers-carry 100',
      'run 1000 → sandbag-lunges 50',
      'run 1000 → wall-balls 50',
    ])
  })

  it('tapers in Weeks 22 and 23 with every Session type kept and each shorter, then races in Week 24', () => {
    for (const n of [22, 23]) {
      expect(byNumber(n).sessions.map((s) => s.type)).toEqual(['strength', 'hyrox', 'run', 'hyrox', 'easy'])
    }
    expect(byNumber(22).sessions.map((s) => s.minutes)).toEqual([30, 30, 30, 30, 30])
    expect(byNumber(23).sessions.map((s) => s.minutes)).toEqual([20, 20, 25, 20, 20])
    expect(rounds(session(22, 'hyrox-a'))).toEqual(['sled-push 25 → run 600', 'sled-pull 25 → run 600', 'sandbag-lunges 50 → run 600'])
    expect(rounds(session(23, 'hyrox-b'))).toEqual(['skierg 500 → run 400', 'wall-balls 50 → run 400'])
    expect(describeSession(session(22, 'run')).heading).toBe('Run, 3 × 5′')
    expect(describeSession(session(23, 'run')).heading).toBe('Run, 20′ easy + 4 × 1′')
    expect(byNumber(24).sessions.map((s) => s.id)).toEqual(['shakeout', 'station-touch', 'race'])
    expect(rounds(session(24, 'station-touch'))).toEqual(['sled-push 25 → wall-balls 20'])
    expect(byNumber(24).notes).toEqual([
      'Wednesday 21 April: rest. Prepare kit; familiar meals and hydration; confirm the start time.',
      'Thursday 22 April: race.',
      'Friday: recovery, walking only as comfortable.',
    ])
  })

  it('grows the Easy run into a 60-minute long run by Week 17', () => {
    const easy = weeks.filter((w) => !w.race).map((w) => session(w.number, 'easy').minutes)
    expect(easy).toEqual([25, 25, 30, 30, 25, 35, 35, 40, 40, 30, 45, 45, 50, 50, 35, 55, 60, 50, 60, 35, 40, 30, 20])
    expect(weeks.find((w) => session(w.number, 'easy')?.minutes === 60)!.number).toBe(17)
  })
})

describe('HYROX A and HYROX B', () => {
  it('trains the sleds and carries in A and the ergs, the jumps and the ball in B, in race order, wall balls last', () => {
    expect(rounds(session(1, 'hyrox-a'))).toEqual([
      'sled-push 25 → run 400',
      'sled-pull 25 → run 400',
      'farmers-carry 100 → run 400',
      'sandbag-lunges 25 → run 400',
    ])
    expect(rounds(session(1, 'hyrox-b'))).toEqual(['skierg 250 → run 400', 'burpee-broad-jumps 20 → run 400', 'row 250 → run 400', 'wall-balls 25 → run 400'])
    for (const s of weeks.flatMap((w) => w.sessions).filter((s) => s.id === 'hyrox-b')) {
      expect(rounds(s).at(-1)).toMatch(/^wall-balls/)
    }
  })

  it('climbs the Station volume table Phase by Phase, with the run after each Station', () => {
    const volumes = (n: number, id: string) => rounds(session(n, id))
    expect(volumes(6, 'hyrox-a')).toEqual(['sled-push 25 → run 600', 'sled-pull 25 → run 600', 'farmers-carry 100 → run 600', 'sandbag-lunges 50 → run 600'])
    expect(volumes(6, 'hyrox-b')).toEqual(['skierg 500 → run 600', 'burpee-broad-jumps 40 → run 600', 'row 500 → run 600', 'wall-balls 50 → run 600'])
    expect(volumes(11, 'hyrox-a')).toEqual(['sled-push 50 → run 800', 'sled-pull 50 → run 800', 'farmers-carry 200 → run 800', 'sandbag-lunges 75 → run 800'])
    expect(volumes(11, 'hyrox-b')).toEqual(['skierg 750 → run 800', 'burpee-broad-jumps 60 → run 800', 'row 750 → run 800', 'wall-balls 75 → run 800'])
    expect(volumes(17, 'hyrox-a')).toEqual([
      'sled-push 50 → run 1000',
      'sled-pull 50 → run 1000',
      'farmers-carry 200 → run 1000',
      'sandbag-lunges 100 → run 1000',
    ])
    // B's runs stay at 600 m in Race specific so the Session fits the cap.
    expect(volumes(17, 'hyrox-b')).toEqual(['skierg 1000 → run 600', 'burpee-broad-jumps 80 → run 600', 'row 1000 → run 600', 'wall-balls 100 → run 600'])
  })

  it('is four rounds in a normal Week and three in a Deload, Race load kept; Week 20 at half volume', () => {
    for (const week of weeks.filter((w) => w.number <= 21)) {
      for (const s of week.sessions.filter((s) => s.type === 'hyrox')) {
        const expected = week.deload || (week.number === 21 && s.id === 'hyrox-b') ? 3 : 4
        expect({ week: week.number, id: s.id, rounds: rounds(s).length }).toEqual({ week: week.number, id: s.id, rounds: expected })
      }
    }
    expect(rounds(session(5, 'hyrox-a'))).toEqual(['sled-push 25 → run 400', 'sled-pull 25 → run 400', 'sandbag-lunges 25 → run 400'])
    expect(rounds(session(20, 'hyrox-b'))).toEqual(['skierg 500 → run 600', 'burpee-broad-jumps 40 → run 600', 'wall-balls 50 → run 600'])
  })

  it('reads as rounds of a Station then a run, at Race load', () => {
    expect(describeSession(session(1, 'hyrox-a'))).toMatchObject({
      heading: 'HYROX A, 4 rounds',
      summary: '4 × (Station + 400 m)',
      target: 'Station, then 400 m, each round · Race load',
      meta: '45 min + ~5′ setup',
    })
  })

  it('sets up once, untimed, before round 1, so it’s in neither the minutes nor the Training load', () => {
    const blocks = session(1, 'hyrox-a').blocks
    expect(blocks.map((b) => [b.name, b.minutes])).toEqual([
      ['Warm-up', 5],
      ['Set up', undefined],
      ['Round 1', 9],
      ['Round 2', 9],
      ['Round 3', 9],
      ['Round 4', 9],
      ['Cooldown', 4],
    ])
    expect(session(1, 'hyrox-a').minutes).toBe(45)
  })

  it('lists every Station the Session loads once, at Race load, and says when the rest have nothing to load', () => {
    const setUp = (n: number, id: string) => session(n, id).blocks.find((b) => b.setup)!
    const loads = (n: number, id: string) =>
      setUp(n, id)
        .exercises.map((e) => describeExercise(e, program.stations))
        .map((l) => `${l.name}: ${l.detail}`)
    expect(loads(1, 'hyrox-a')).toEqual([
      'Sled push: 335 lb plates',
      'Sled pull: 225 lb plates',
      'Farmers carry: 2 × 55 lb',
      'Sandbag lunges: 45 lb',
    ])
    expect(setUp(1, 'hyrox-a').note).toBeUndefined()
    expect(loads(1, 'hyrox-b')).toEqual(['Wall balls: 13 lb ball'])
    expect(setUp(1, 'hyrox-b').note).toBe('Nothing else to load.')
  })

  it('is the only Session type with a Set up', () => {
    const all = weeks.flatMap((w) => w.sessions)
    expect(all.filter((s) => s.blocks.some((b) => b.setup)).every((s) => s.type === 'hyrox')).toBe(true)
    expect(all.filter((s) => s.type === 'hyrox' && !s.date).every((s) => s.blocks.some((b) => b.setup))).toBe(true)
  })
})

describe('the Run', () => {
  it('is Threshold intervals in Foundation, then alternates with Compromised intervals from Build', () => {
    const runs = weeks.filter((w) => w.number <= 21).map((w) => [w.number, byNumber(w.number).sessions.find((s) => s.type === 'run')?.headline ?? null])
    expect(Object.fromEntries(runs)).toEqual({
      1: '3 × 7′',
      2: null,
      3: '3 × 8′',
      4: '4 × 6′',
      5: '35′ easy',
      6: '4 × (1 km + 20 wall balls)',
      7: '3 × 8′',
      8: '4 × (1 km + 20 wall balls)',
      9: null,
      10: '35′ easy',
      11: '5 × (1 km + 20 wall balls)',
      12: '4 × 7′',
      13: '5 × (1 km + 20 wall balls)',
      14: null,
      15: '35′ easy',
      16: '3 × 8′',
      17: '5 × (1 km + 20 wall balls)',
      18: '4 × 6′',
      19: null,
      20: '35′ easy',
      21: '3 × 6′',
    })
  })

  it('runs Threshold reps at Threshold pace with a 90″ jog, never racing', () => {
    expect(describeExercise(exercises(session(1, 'run')).find((e) => e.name === 'Threshold reps')!, program.stations)).toMatchObject({
      detail: '3 × 7′ / 90″ jog · Threshold effort, RPE 6–7',
      note: 'Never racing.',
    })
  })

  it('runs Compromised intervals as 1 km at Race run pace, then 20 wall balls at 13 lb', () => {
    const run = session(6, 'run')
    expect(rounds(run)).toEqual(Array(4).fill('run 1000 → wall-balls 20'))
    expect(run.blocks.find((b) => b.main)!.exercises[0].prescription).toMatchObject({ effort: { pace: 'race-run' } })
    expect(describeSession(run).summary).toBe('4 × (1 km + Wall balls)')
    expect(describeExercise(exercises(run).find((e) => e.name === 'Wall balls')!, program.stations).detail).toBe('20 reps · 13 lb ball')
  })
})

describe('Strength', () => {
  const names = (n: number) => exercises(session(n, 'strength')).map((e) => e.name)
  const line = (n: number, name: string) => describeExercise(exercises(session(n, 'strength')).find((e) => e.name === name)!, program.stations)

  it('carries the heavy farmers carry in place of the pull-up and push-up superset', () => {
    expect(names(2)).toEqual([
      'Bike, movement prep and ramp-up sets',
      'Back squat',
      'Romanian deadlift',
      'Bulgarian split squat',
      'Heavy farmers carry',
      'Standing calf raise',
      'Seated calf raise',
    ])
    expect(line(2, 'Heavy farmers carry').detail).toBe('3 × 40 m · RPE 7')
  })

  it('calibrates every lift in Week 1', () => {
    for (const { prescription: rx } of exercises(session(1, 'strength')).filter((e) => e.prescription.kind === 'sets')) {
      expect(rx.kind === 'sets' && rx.load.kind).toBe('find-working-weight')
    }
  })

  it('switches to 2 × 4 at RPE 7–8 without the split squat from Week 16', () => {
    expect(line(15, 'Back squat').detail).toBe('2 × 5 · 85–90% of Working weight · RPE ≤ 6 · 90–120″ rest')
    expect(line(14, 'Back squat').detail).toBe('3 × 5 · RPE 7 · 90–120″ rest')
    for (const n of [16, 17, 18, 19, 21]) {
      expect(line(n, 'Back squat').detail).toBe('2 × 4 · RPE 7–8 · 90–120″ rest')
      expect(line(n, 'Romanian deadlift').detail).toBe('2 × 4 · RPE 7–8')
      expect(line(n, 'Heavy farmers carry').detail).toBe('2 × 40 m · RPE 7')
      expect(names(n)).not.toContain('Bulgarian split squat')
    }
  })
})

describe('Race loads', () => {
  it('holds the Men’s Open Race loads, with sled loads as plate weight', () => {
    const { stations } = program
    expect(stations['sled-push'].raceLoad).toEqual({ meters: 50, pounds: 335 })
    expect(stations['sled-pull'].raceLoad).toEqual({ meters: 50, pounds: 227 })
    expect(stations['farmers-carry'].raceLoad).toEqual({ meters: 200, pounds: 53, implements: 2 })
    expect(stations['sandbag-lunges'].raceLoad).toEqual({ meters: 100, pounds: 44 })
    expect(stations['wall-balls'].raceLoad).toEqual({ reps: 100, pounds: 13, fixedLoad: true })
  })

  it('prescribes every Station at Race load in pounds, rounded to 5 lb, sled loads as plates, the ball as it is', () => {
    const { stations } = program
    expect(stationLoad(stations['sled-push'])).toBe('335 lb plates')
    expect(stationLoad(stations['sled-pull'])).toBe('225 lb plates')
    expect(stationLoad(stations['farmers-carry'])).toBe('2 × 55 lb')
    expect(stationLoad(stations['sandbag-lunges'])).toBe('45 lb')
    expect(stationLoad(stations['wall-balls'])).toBe('13 lb ball')
    expect(stationLoad(stations.skierg)).toBe('')
    const detail = (id: StationId) =>
      describeExercise(session(17, 'hyrox-a').blocks.filter((b) => b.main).flatMap((b) => b.exercises).find((e) => e.prescription.kind === 'station' && e.prescription.station === id)!, program.stations).detail
    expect(detail('sled-push')).toBe('50 m · 335 lb plates')
    expect(detail('farmers-carry')).toBe('200 m · 2 × 55 lb')
  })
})
