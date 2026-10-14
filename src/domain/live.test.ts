import { describe, expect, it } from 'vitest'
import { localDate } from './calendar'
import { findWeek } from './coach'
import {
  advance,
  answer,
  blockLeft,
  end,
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
