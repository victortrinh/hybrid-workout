import { describe, expect, it } from 'vitest'
import { localDate } from './calendar'
import { findWeek } from './coach'
import {
  advance,
  answer,
  answerStations,
  blockLeft,
  end,
  isLive,
  isLiveRun,
  isOver,
  liveBlocks,
  liveLog,
  liveTarget,
  nextBlock,
  parseLiveRun,
  pause,
  resume,
  startRun,
  stationLogs,
  type LiveBlock,
  type LiveRun,
} from './live'
import { trainingPaces, type RunContext } from './paces'
import { program } from './program/program'
import type { Session } from './program/types'

const session = (week: number, id: string): Session => {
  const found = findWeek(program, week)?.sessions.find((s) => s.id === id)
  if (!found) throw new Error(`No ${id} in Week ${week}`)
  return found
}

const MIN = 60_000
const T0 = Date.parse('2026-11-04T17:00:00Z')
const at = (minutes: number) => T0 + minutes * MIN

/** A 23:00 5K test: Threshold 4:52/km, 12.3 km/h. */
const paces = trainingPaces(23 * 60)
const indoor: RunContext = { paces, environment: 'indoor', unit: 'kmh' }

const start = (s: Session, environment: 'indoor' | 'outdoor' = 'indoor'): LiveRun =>
  startRun({ week: 3, session: s, date: localDate('2026-11-04'), environment }, T0)

describe('liveBlocks', () => {
  it('lays Threshold out as warm-up, reps with jogs between, then the cooldown', () => {
    const blocks = liveBlocks(session(3, 'threshold'))
    expect(blocks.map((b) => [b.name, b.seconds, b.lane, b.rep, b.work])).toEqual([
      ['Warm-up', 600, 'easy', null, false],
      ['Rep 1 of 2', 720, 'threshold', 1, true],
      ['Jog', 120, 'easy', null, false],
      ['Rep 2 of 2', 720, 'threshold', 2, true],
      ['Easy and cooldown', 540, 'easy', null, false],
    ])
    expect(blocks.reduce((sum, b) => sum + (b.seconds ?? 0), 0)).toBe(45 * 60)
  })

  it('keeps Speed’s drills, plyometrics and accelerations as Blocks of their own', () => {
    const blocks = liveBlocks(session(3, 'speed'))
    expect(blocks.map((b) => b.name)).toEqual([
      'Warm-up',
      'Plyometrics',
      'Accelerations',
      ...[1, 2, 3, 4, 5].flatMap((n) => (n < 5 ? [`Rep ${n} of 5`, 'Jog'] : [`Rep ${n} of 5`])),
      'Cooldown',
    ])
    expect(blocks[0].detail).toEqual(['Leg swings, skips, drills'])
    expect(blocks[1]).toMatchObject({ kind: 'drills', seconds: 300, effort: null, detail: ['Pogo jumps 2 × 15', 'Broad jumps 3 × 3'] })
    expect(blocks[2].detail).toEqual(['Accelerations 4 × 15 m at 80–90%'])
    expect(blocks[3]).toMatchObject({ seconds: 180, lane: 'speed' })
    expect(blocks[4]).toMatchObject({ seconds: 90, kind: 'recovery' })
  })

  it('runs an Easy run as one Block, and a 5K test’s 5 km to the distance, not the clock', () => {
    expect(liveBlocks(session(3, 'easy'))).toMatchObject([{ name: 'Easy run', seconds: 25 * 60, lane: 'easy', work: true }])
    const test = liveBlocks(session(2, '5k-test'))
    expect(test.map((b) => [b.name, b.kind, b.seconds, b.meters])).toEqual([
      ['Warm-up', 'warm-up', 720, null],
      ['5 km', 'distance', null, 5000],
      ['Cooldown', 'cooldown', 480, null],
    ])
    expect(test[0].detail).toEqual(['Strides 4 × 15″'])
  })

  it('covers only Sessions that are all running', () => {
    expect(['speed', 'strength', 'threshold', 'hyrox', 'easy'].map((id) => isLiveRun(session(3, id)))).toEqual([
      true, false, true, false, true,
    ])
    expect(isLiveRun(session(2, '5k-test'))).toBe(true)
  })

  it('runs everything live but Strength: HYROX and Race simulations too', () => {
    expect(['speed', 'strength', 'threshold', 'hyrox', 'easy'].map((id) => isLive(session(3, id)))).toEqual([
      true, false, true, true, true,
    ])
    expect(isLive(session(18, 'race-simulation'))).toBe(true)
  })
})

describe('liveTarget', () => {
  const [, rep, jog] = liveBlocks(session(3, 'threshold'))

  it('reads Threshold as treadmill speed and incline indoors, in either unit', () => {
    expect(liveTarget(rep, indoor)).toEqual({
      value: '12.3',
      unit: 'km/h',
      incline: 1,
      pace: 292,
      words: '12.3 km/h · 1% incline',
    })
    expect(liveTarget(rep, { ...indoor, unit: 'mph' })).toMatchObject({ value: '7.7', unit: 'mph' })
  })

  it('reads it as pace per km outdoors', () => {
    expect(liveTarget(rep, { ...indoor, environment: 'outdoor' })).toMatchObject({ value: '4:52', unit: '/km', incline: null })
  })

  it('takes the middle of an Easy range for the hero figure and keeps the range in words', () => {
    const target = liveTarget(jog, indoor)!
    const [fast, slow] = paces.easy
    expect(target.pace).toBe(Math.round((fast + slow) / 2))
    expect(target.words).toMatch(/^\d+\.\d–\d+\.\d km\/h · 1% incline$/)
  })

  it('is the RPE before the baseline 5K test, and nothing for drills or a run by feel alone', () => {
    expect(liveTarget(rep, { ...indoor, paces: null })).toEqual({ value: '6–7', unit: 'RPE', incline: 1, pace: null, words: 'RPE 6–7' })
    const speed = liveBlocks(session(3, 'speed'))
    expect(liveTarget(speed[1], indoor)).toBeNull()
    expect(liveTarget(speed[3], indoor)).toBeNull()
  })
})

describe('the Live run clock', () => {
  it('walks through the Blocks as time passes, asking after each rep', () => {
    let run = start(session(3, 'threshold'))
    expect(advance(run, at(9.9))).toBe(run)
    expect(blockLeft(run, at(9.5))).toBe(30)

    run = advance(run, at(10))
    expect(run.block).toBe(1)
    expect(blockLeft(run, at(10))).toBe(720)

    run = advance(run, at(22.5))
    expect(run).toMatchObject({ block: 2, asks: [1] })
    expect(blockLeft(run, at(23))).toBe(60)
  })

  it('catches up on everything that happened while the phone was locked', () => {
    const run = advance(start(session(3, 'threshold')), at(40))
    expect(run).toMatchObject({ block: 4, asks: [1, 3] })
    expect(blockLeft(run, at(40))).toBe(5 * 60)

    const over = advance(run, at(60))
    expect(over.block).toBe(5)
    expect(over.finishedAt).toBe(at(45))
    expect(isOver(over)).toBe(true)
  })

  it('stops while paused and picks up where it left off', () => {
    let run = pause(start(session(3, 'threshold')), at(5))
    expect(blockLeft(run, at(30))).toBe(300)
    expect(advance(run, at(30))).toBe(run)

    run = resume(run, at(30))
    expect(blockLeft(run, at(30))).toBe(300)
    run = advance(run, at(35))
    expect(run.block).toBe(1)
    expect(run.blockStartedAt).toBe(at(35))
  })

  it('skips a Block at once, paused or not, and remembers it was cut short', () => {
    let run = nextBlock(start(session(3, 'threshold')), at(2))
    expect(run).toMatchObject({ block: 1, skipped: [0] })
    expect(blockLeft(run, at(3))).toBe(660)

    run = nextBlock(pause(run, at(3)), at(4))
    expect(run).toMatchObject({ block: 2, skipped: [0, 1], asks: [1], pausedAt: at(3) })
    run = resume(run, at(4))
    expect(blockLeft(run, at(5))).toBe(60)
  })

  it('times a 5K test’s 5 km from its start to the tap that says it’s covered', () => {
    let run = advance(start(session(2, '5k-test')), at(12))
    expect(run.block).toBe(1)
    expect(blockLeft(run, at(30))).toBeNull()
    expect(advance(run, at(60))).toBe(run)

    run = nextBlock(run, at(34.5))
    expect(run).toMatchObject({ block: 2, splits: [{ block: 1, seconds: 22 * 60 + 30 }], skipped: [] })
  })

  it('ends on the finish sheet, and Keep going goes back to the clock', () => {
    const run = end(advance(start(session(3, 'threshold')), at(15)), at(15))
    expect(run).toMatchObject({ ending: true, pausedAt: at(15), block: 1 })
    expect(isOver(run)).toBe(true)

    const back = resume(run, at(16))
    expect(isOver(back)).toBe(false)
    expect(blockLeft(back, at(16))).toBe(720 - 300)
  })

  it('records Held it and Changed once per rep', () => {
    let run = advance(start(session(3, 'threshold')), at(40))
    run = answer(run, 3, 292, 298)
    run = answer(run, 1, 292, null)
    expect(answer(run, 1, 292, null)).toBe(run)
    expect(run.asks).toEqual([])
    expect(run.intervals).toEqual([
      { block: 1, rep: 1, targetPace: 292, held: true, actualPace: null },
      { block: 3, rep: 2, targetPace: 292, held: false, actualPace: 298 },
    ])
  })
})

describe('liveLog', () => {
  const input = { id: 'live-1234', rpe: 7, distanceMeters: 9400, resultSeconds: null, updatedAt: '2026-11-04T18:00:00.000Z' }

  it('logs a Session run to the end as Done, with its time, Environment, distance and reps', () => {
    let run = pause(advance(start(session(3, 'threshold')), at(5)), at(5))
    run = advance(resume(run, at(7)), at(60))
    run = answer(run, 1, 292, null)
    expect(liveLog(run, at(60), input)).toEqual({
      id: 'live-1234',
      week: 3,
      sessionId: 'threshold',
      date: '2026-11-04',
      status: 'done',
      minutes: 45,
      rpe: 7,
      notes: null,
      resultSeconds: null,
      environment: 'indoor',
      distanceMeters: 9400,
      intervals: [{ block: 1, rep: 1, targetPace: 292, held: true, actualPace: null }],
      sets: [],
      stations: [],
      updatedAt: '2026-11-04T18:00:00.000Z',
    })
  })

  it('is Partial when a rep was skipped or the Session ended before the reps were done', () => {
    const skipped = advance(nextBlock(advance(start(session(3, 'threshold')), at(10)), at(11)), at(60))
    expect(liveLog(skipped, at(60), input).status).toBe('partial')
    const ended = end(advance(start(session(3, 'threshold')), at(20)), at(20))
    expect(liveLog(ended, at(25), input)).toMatchObject({ status: 'partial', minutes: 20 })
    const inCooldown = end(advance(start(session(3, 'threshold')), at(40)), at(40))
    expect(liveLog(inCooldown, at(40), input).status).toBe('done')
  })

  it('keeps a 5K test’s time only when the 5 km was covered, and the console distance only indoors', () => {
    const covered = nextBlock(advance(start(session(2, '5k-test'), 'outdoor'), at(12)), at(34.5))
    expect(liveLog(end(covered, at(36)), at(36), { ...input, resultSeconds: 1350 })).toMatchObject({
      sessionId: '5k-test',
      status: 'done',
      resultSeconds: 1350,
      environment: 'outdoor',
      distanceMeters: null,
    })
    const cut = end(advance(start(session(2, '5k-test')), at(20)), at(20))
    expect(liveLog(cut, at(20), { ...input, resultSeconds: 1350 })).toMatchObject({ status: 'partial', resultSeconds: null })
  })
})

describe('parseLiveRun', () => {
  it('takes back what was stored, and drops anything it can’t trust', () => {
    const run = advance(start(session(3, 'threshold')), at(12))
    expect(parseLiveRun(JSON.parse(JSON.stringify(run)))).toEqual(run)
    expect(parseLiveRun(null)).toBeNull()
    expect(parseLiveRun({ ...run, blocks: [] })).toBeNull()
    expect(parseLiveRun({ ...run, type: 'strength' })).toBeNull()
    expect(parseLiveRun({ ...run, startedAt: 'yesterday' })).toBeNull()
  })
})

describe('HYROX', () => {
  const rounds = (week: number) => liveBlocks(session(week, 'hyrox')).filter((b) => b.kind === 'round')
  /** Each round as its run and its Stations: "600 m: sled-push 25 m, sled-pull 25 m". */
  const layout = (week: number) =>
    rounds(week).map(
      (b) => `${b.meters} m: ${b.stations.map((s) => `${s.station} ${s.meters ? `${s.meters} m` : `${s.reps} reps`}`).join(', ')}`,
    )
  /** The pounds each Station of the Session is loaded with. */
  const loads = (blocks: LiveBlock[]) =>
    Object.fromEntries(blocks.flatMap((b) => b.stations).map((s) => [s.station, s.pounds]))

  it('runs warm-up, three rounds on a clock that counts up, and the cooldown', () => {
    expect(liveBlocks(session(1, 'hyrox')).map((b) => [b.name, b.kind, b.seconds, b.round, b.work])).toEqual([
      ['Warm-up', 'warm-up', 420, null, false],
      ['Round 1 of 3', 'round', null, 1, true],
      ['Round 2 of 3', 'round', null, 2, true],
      ['Round 3 of 3', 'round', null, 3, true],
      ['Cooldown', 'cooldown', 300, null, false],
    ])
  })

  it('takes the run distance and Station volume from the Phase, and Rotation A or B from the Week', () => {
    expect(layout(1)).toEqual([
      '600 m: sled-push 25 m, sled-pull 25 m',
      '600 m: farmers-carry 50 m, sandbag-lunges 25 m',
      '600 m: sled-push 25 m, sled-pull 25 m',
    ])
    expect(layout(2)).toEqual([
      '600 m: skierg 250 m, burpee-broad-jumps 10 m',
      '600 m: row 250 m, wall-balls 20 reps',
      '600 m: skierg 250 m, burpee-broad-jumps 10 m',
    ])
    expect(layout(7)).toEqual([
      '700 m: sled-push 25 m, sled-pull 25 m, farmers-carry 100 m',
      '700 m: sandbag-lunges 50 m, sled-push 25 m',
      '700 m: sled-pull 25 m, farmers-carry 100 m, sandbag-lunges 50 m',
    ])
    expect(layout(19)).toEqual(['800 m: skierg 500 m, burpee-broad-jumps 40 m', '800 m: row 500 m, wall-balls 50 reps', '800 m: skierg 500 m'])
    expect(layout(23)).toEqual(['1000 m: sled-push 50 m', '1000 m: sled-pull 50 m', '1000 m: sandbag-lunges 100 m'])
  })

  it('cuts a Deload week to a two-round technique circuit', () => {
    expect(layout(4)).toEqual(['600 m: skierg 250 m, burpee-broad-jumps 10 m', '600 m: row 250 m, wall-balls 20 reps'])
  })

  it.each([
    // Week, Phase and share of Race load: plate weight on the sleds, per hand on the farmers carry, to the nearest 5 lb.
    [1, 'Foundation, 60%', { 'sled-push': 200, 'sled-pull': 135, 'farmers-carry': 30, 'sandbag-lunges': 25 }],
    [7, '5K development, 70%', { 'sled-push': 235, 'sled-pull': 160, 'farmers-carry': 35, 'sandbag-lunges': 30 }],
    [11, '5K development, 75%', { 'sled-push': 250, 'sled-pull': 170, 'farmers-carry': 40, 'sandbag-lunges': 35 }],
    [13, '5K development, 80%', { 'sled-push': 270, 'sled-pull': 180, 'farmers-carry': 40, 'sandbag-lunges': 35 }],
    [15, 'HYROX build, 90%', { 'sled-push': 300, 'sled-pull': 205, 'farmers-carry': 50, 'sandbag-lunges': 40 }],
    [20, 'HYROX build, 100%', { 'sled-push': 335, 'sled-pull': 225, 'farmers-carry': 55, 'sandbag-lunges': 45 }],
    [23, 'Race specific, 100%', { 'sled-push': 335, 'sled-pull': 225, 'sandbag-lunges': 45 }],
  ])('loads Week %i (%s) from Race load', (week, _, pounds) => {
    expect(loads(rounds(week))).toEqual(pounds)
  })

  it('never scales the wall ball, and gives Stations without a load no pounds', () => {
    expect(loads(rounds(2))).toEqual({ skierg: null, 'burpee-broad-jumps': null, row: null, 'wall-balls': 13 })
    expect(loads(rounds(19))['wall-balls']).toBe(13)
  })

  it('times each round from the tap that ends it, and logs the round, its run and its Stations', () => {
    let run = startRun({ week: 1, session: session(1, 'hyrox'), date: localDate('2026-10-21'), environment: 'indoor' }, T0)
    run = advance(run, at(7))
    expect(run.blocks[run.block].name).toBe('Round 1 of 3')
    expect(blockLeft(run, at(9))).toBeNull()

    run = nextBlock(run, at(17))
    expect(run.asks).toEqual([1])
    // Round 1 was heavy: the sled push went down to 180 lb and the run was 500 m.
    const [push, pull] = run.blocks[1].stations
    run = answerStations(run, 1, { runMeters: 500, stations: [{ ...push, pounds: 180 }, pull] })
    expect(run.asks).toEqual([])
    // The lighter sled push carries on to round 3; round 2 has no sled push.
    expect(run.blocks[3].stations[0]).toEqual({ station: 'sled-push', meters: 25, reps: null, pounds: 180 })

    run = nextBlock(run, at(28.5))
    // Round 2 is never answered: it logs as written.
    run = nextBlock(run, at(39))
    run = advance(run, at(44))
    expect(isOver(run)).toBe(true)

    expect(stationLogs(run)).toEqual([
      { round: 1, part: 'round', pounds: null, meters: null, reps: null, seconds: 600 },
      { round: 1, part: 'run', pounds: null, meters: 500, reps: null, seconds: null },
      { round: 1, part: 'sled-push', pounds: 180, meters: 25, reps: null, seconds: null },
      { round: 1, part: 'sled-pull', pounds: 135, meters: 25, reps: null, seconds: null },
      { round: 2, part: 'round', pounds: null, meters: null, reps: null, seconds: 690 },
      { round: 2, part: 'run', pounds: null, meters: 600, reps: null, seconds: null },
      { round: 2, part: 'farmers-carry', pounds: 30, meters: 50, reps: null, seconds: null },
      { round: 2, part: 'sandbag-lunges', pounds: 25, meters: 25, reps: null, seconds: null },
      { round: 3, part: 'round', pounds: null, meters: null, reps: null, seconds: 630 },
      { round: 3, part: 'run', pounds: null, meters: 600, reps: null, seconds: null },
      { round: 3, part: 'sled-push', pounds: 180, meters: 25, reps: null, seconds: null },
      { round: 3, part: 'sled-pull', pounds: 135, meters: 25, reps: null, seconds: null },
    ])
    const input = { id: 'hyrox-1234', rpe: 7, distanceMeters: 1800, resultSeconds: null, updatedAt: '2026-10-21T18:00:00.000Z' }
    expect(liveLog(run, at(44), input)).toMatchObject({ status: 'done', minutes: 44, distanceMeters: null, stations: stationLogs(run) })
  })

  it('logs only the rounds finished, Partial, when it ends early', () => {
    let run = startRun({ week: 1, session: session(1, 'hyrox'), date: localDate('2026-10-21'), environment: 'outdoor' }, T0)
    run = end(nextBlock(advance(run, at(7)), at(18)), at(25))
    expect(stationLogs(run).filter((l) => l.part === 'round')).toEqual([
      { round: 1, part: 'round', pounds: null, meters: null, reps: null, seconds: 660 },
    ])
    expect(liveStatusOf(run)).toBe('partial')
  })
})

const liveStatusOf = (run: LiveRun) => liveLog(run, at(60), { id: 'x', rpe: 7, distanceMeters: null, resultSeconds: null, updatedAt: '' }).status

describe('Race simulations', () => {
  const sim = (week: number) => liveBlocks(session(week, 'race-simulation'))
  const legs = (week: number) =>
    sim(week)
      .filter((b) => b.round !== null)
      .map((b) => (b.kind === 'distance' ? `run ${b.meters} m` : `${b.stations[0].station} ${b.stations[0].meters ?? b.stations[0].reps} @ ${b.stations[0].pounds}`))

  it('runs Week 18 as half simulation A: a split for each 1 km run and each of Stations 1–4, in race order', () => {
    expect(sim(18).map((b) => [b.name, b.kind, b.seconds])).toEqual([
      ['Warm-up', 'warm-up', 600],
      ['Run 1', 'distance', null],
      ['SkiErg', 'station', null],
      ['Run 2', 'distance', null],
      ['Sled push', 'station', null],
      ['Run 3', 'distance', null],
      ['Sled pull', 'station', null],
      ['Run 4', 'distance', null],
      ['Burpee broad jumps', 'station', null],
      ['Cooldown', 'cooldown', 300],
    ])
    expect(legs(18)).toEqual([
      'run 1000 m', 'skierg 1000 @ null', 'run 1000 m', 'sled-push 50 @ 335', 'run 1000 m', 'sled-pull 50 @ 225', 'run 1000 m',
      'burpee-broad-jumps 80 @ null',
    ])
  })

  it('runs Week 21 as half simulation B over Stations 5–8 at race volume', () => {
    expect(legs(21)).toEqual([
      'run 1000 m', 'row 1000 @ null', 'run 1000 m', 'farmers-carry 200 @ 55', 'run 1000 m', 'sandbag-lunges 100 @ 45', 'run 1000 m',
      'wall-balls 100 @ 13',
    ])
  })

  it('runs Week 24 as eight full 1 km runs with every Station at half race volume and Race load', () => {
    expect(legs(24)).toEqual([
      'run 1000 m', 'skierg 500 @ null',
      'run 1000 m', 'sled-push 25 @ 335',
      'run 1000 m', 'sled-pull 25 @ 225',
      'run 1000 m', 'burpee-broad-jumps 40 @ null',
      'run 1000 m', 'row 500 @ null',
      'run 1000 m', 'farmers-carry 100 @ 55',
      'run 1000 m', 'sandbag-lunges 50 @ 45',
      'run 1000 m', 'wall-balls 50 @ 13',
    ])
  })

  it('logs a split on every run and Station in race order', () => {
    let run = startRun({ week: 18, session: session(18, 'race-simulation'), date: localDate('2027-02-17'), environment: 'indoor' }, T0)
    run = advance(run, at(10))
    // 1 km in 4:30, SkiErg in 4:15, and so on: a tap at the end of each.
    const taps = [4.5, 4.25, 4.75, 3, 4.75, 3.5, 5, 6]
    let now = 10
    for (const minutes of taps) run = nextBlock(run, at((now += minutes)))
    // The SkiErg is answered as written; the sled push went on with 315 lb.
    run = answerStations(run, 2, null)
    run = answerStations(run, 4, { stations: [{ ...run.blocks[4].stations[0], pounds: 315 }] })
    run = advance(run, at(now + 5))

    expect(stationLogs(run)).toEqual([
      { round: 1, part: 'run', pounds: null, meters: 1000, reps: null, seconds: 270 },
      { round: 1, part: 'skierg', pounds: null, meters: 1000, reps: null, seconds: 255 },
      { round: 2, part: 'run', pounds: null, meters: 1000, reps: null, seconds: 285 },
      { round: 2, part: 'sled-push', pounds: 315, meters: 50, reps: null, seconds: 180 },
      { round: 3, part: 'run', pounds: null, meters: 1000, reps: null, seconds: 285 },
      { round: 3, part: 'sled-pull', pounds: 225, meters: 50, reps: null, seconds: 210 },
      { round: 4, part: 'run', pounds: null, meters: 1000, reps: null, seconds: 300 },
      { round: 4, part: 'burpee-broad-jumps', pounds: null, meters: 80, reps: null, seconds: 360 },
    ])
    expect(liveStatusOf(run)).toBe('done')
  })
})

describe('parseLiveRun for HYROX', () => {
  it('takes back a HYROX session in progress', () => {
    const run = nextBlock(advance(startRun({ week: 1, session: session(1, 'hyrox'), date: localDate('2026-10-21'), environment: 'indoor' }, T0), at(7)), at(17))
    expect(parseLiveRun(JSON.parse(JSON.stringify(run)))).toEqual(run)
  })
})
