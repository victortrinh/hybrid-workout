import { describe, expect, it } from 'vitest'
import { localDate } from './calendar'
import { findWeek } from './coach'
import { equip } from './equipment'
import {
  advance,
  answer,
  blockElapsed,
  canUndo,
  goBack,
  markDone,
  redone,
  shortBlocks,
  tick,
  undo,
  answerStations,
  blockLeft,
  end,
  heldUnanswered,
  isLive,
  isLiveRun,
  isOver,
  liveBlocks,
  liveStatus,
  liveLog,
  liveTarget,
  nextBlock,
  parseLiveRun,
  pause,
  predictedRpe,
  sessionRpe,
  resume,
  startRun,
  stationLogs,
  activeSeconds,
  currentLeg,
  fastestSplit,
  legElapsed,
  quickSplits,
  roundLegs,
  type SplitFix,
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
const T0 = Date.parse('2026-11-11T17:00:00Z')
const at = (minutes: number) => T0 + minutes * MIN

/** A 23:00 5K test: Threshold 4:52/km, 12.3 km/h. */
const paces = trainingPaces(23 * 60)
const indoor: RunContext = { paces, environment: 'indoor', unit: 'kmh' }

const start = (s: Session, environment: 'indoor' | 'outdoor' = 'indoor'): LiveRun =>
  startRun({ week: 3, session: s, date: localDate('2026-11-11'), environment }, T0)

/** The clock caught up to `now`, and Start tapped at once if it holds on a Ready screen. */
const go = (run: LiveRun, now: number) => resume(advance(run, now), now)
/** Skip block, Done or Finished, then Start at once if the next Block holds on Ready. */
const tap = (run: LiveRun, now: number) => resume(nextBlock(run, now), now)
/** A 5K test on its 5 km at minute 12: the jog ran its 10, the strides were Done at 12, Start at once. */
const onFiveK = (run: LiveRun) => tap(advance(run, at(10)), at(12))
/** A HYROX session on round 1 at minute 7: the jog ran its 5, lunges Done at 6, Set up Done at 7, Start at once. */
const onRound1 = (run: LiveRun) => tap(nextBlock(advance(run, at(5)), at(6)), at(7))
/** A HYROX round, a tap at the end of each leg; the last one ends the round and Starts the next on Ready. */
const legs = (run: LiveRun, ...taps: number[]) =>
  taps.reduce((next, t, i) => (i === taps.length - 1 ? tap(next, at(t)) : nextBlock(next, at(t))), run)

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
      'Drills',
      'Plyometrics',
      'Accelerations',
      ...[1, 2, 3, 4, 5].flatMap((n) => (n < 5 ? [`Rep ${n} of 5`, 'Jog'] : [`Rep ${n} of 5`])),
      'Cooldown',
    ])
    expect(blocks[0].detail).toEqual([])
    expect(blocks[2]).toMatchObject({ kind: 'drills', seconds: null, effort: null, detail: ['Pogo jumps 2 × 15', 'Broad jumps 3 × 3'] })
    expect(blocks[3].detail).toEqual(['Accelerations 4 × 15 m at 80–90%'])
    expect(blocks[4]).toMatchObject({ seconds: 180, lane: 'speed' })
    expect(blocks[5]).toMatchObject({ seconds: 90, kind: 'recovery' })
  })

  it('runs an Easy run as one Block, and a 5K test’s 5 km to the distance, not the clock', () => {
    expect(liveBlocks(session(3, 'easy'))).toMatchObject([{ name: 'Easy run', seconds: 25 * 60, lane: 'easy', work: true }])
    const test = liveBlocks(session(2, '5k-test'))
    expect(test.map((b) => [b.name, b.kind, b.seconds, b.meters])).toEqual([
      ['Warm-up', 'warm-up', 600, null],
      ['Strides', 'drills', null, null],
      ['5 km', 'distance', null, 5000],
      ['Cooldown', 'cooldown', 480, null],
    ])
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
    expect(isLive(session(17, 'race-simulation'))).toBe(true)
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

    run = go(run, at(10))
    expect(run.block).toBe(1)
    expect(blockLeft(run, at(10))).toBe(720)

    run = advance(run, at(22.5))
    expect(run).toMatchObject({ block: 2, asks: [1] })
    expect(blockLeft(run, at(23))).toBe(60)
  })

  it('catches up on everything that happened while the phone was locked', () => {
    const run = advance(go(start(session(3, 'threshold')), at(10)), at(40))
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
    run = go(run, at(35))
    expect(run.block).toBe(1)
    expect(blockLeft(run, at(36))).toBe(660)
  })

  it('skips a work Block at once, paused or not, and remembers it was cut short', () => {
    let run = go(start(session(3, 'threshold')), at(10))
    run = nextBlock(run, at(12))
    expect(run).toMatchObject({ block: 2, skipped: [1], asks: [1], cutShort: [{ block: 1, seconds: 120 }] })
    expect(blockLeft(run, at(13))).toBe(60)

    run = nextBlock(pause(go(run, at(14)), at(14)), at(15))
    expect(run).toMatchObject({ block: 4, skipped: [1, 3], pausedAt: at(14) })
  })

  it('ends a Block that isn’t work with Done: not skipped, so the log stays Done', () => {
    let run = nextBlock(start(session(3, 'threshold')), at(6))
    expect(run).toMatchObject({ block: 1, skipped: [], cutShort: [{ block: 0, seconds: 360 }] })
    run = advance(go(run, at(6)), at(60))
    expect(liveStatus(run)).toBe('done')
  })

  it('times a 5K test’s 5 km from its start to the tap that says it’s covered', () => {
    let run = onFiveK(start(session(2, '5k-test')))
    expect(run.block).toBe(2)
    expect(blockLeft(run, at(30))).toBeNull()
    expect(advance(run, at(60))).toBe(run)

    run = nextBlock(run, at(34.5))
    expect(run).toMatchObject({ block: 3, splits: [{ block: 2, seconds: 22 * 60 + 30 }], skipped: [] })
  })

  it('ends on the finish sheet, and Keep going goes back to the clock', () => {
    const run = end(advance(go(start(session(3, 'threshold')), at(10)), at(15)), at(15))
    expect(run).toMatchObject({ ending: true, pausedAt: at(15), block: 1 })
    expect(isOver(run)).toBe(true)

    const back = resume(run, at(16))
    expect(isOver(back)).toBe(false)
    expect(blockLeft(back, at(16))).toBe(720 - 300)
  })

  it('records Held it and Changed once per rep', () => {
    let run = advance(go(start(session(3, 'threshold')), at(10)), at(40))
    run = answer(run, 3, 292, 298)
    run = answer(run, 1, 292, null)
    expect(answer(run, 1, 292, null)).toBe(run)
    expect(run.asks).toEqual([])
    expect(run.intervals).toEqual([
      { block: 1, rep: 1, targetPace: 292, held: true, actualPace: null },
      { block: 3, rep: 2, targetPace: 292, held: false, actualPace: 298 },
    ])
  })

  it('takes silence as Held it, except for a rep cut short', () => {
    let quiet = advance(go(start(session(3, 'threshold')), at(10)), at(45))
    quiet = heldUnanswered(answer(quiet, 3, 292, 298), indoor)
    expect(quiet.asks).toEqual([])
    expect(quiet.intervals.map((i) => [i.block, i.held])).toEqual([
      [1, true],
      [3, false],
    ])

    let cut = advance(go(start(session(3, 'threshold')), at(10)), at(15))
    cut = heldUnanswered(nextBlock(cut, at(15)), indoor)
    expect(cut.intervals).toEqual([])
  })
})

describe('checklist Blocks', () => {
  const speed = () => start(session(3, 'speed'))
  /** On Plyometrics at minute 10: the jog ran its 7, the Drills were Done at 10. */
  const plyometrics = () => nextBlock(advance(speed(), at(7)), at(10))

  it('lays Plyometrics and Accelerations out as a set to tick at a time, on a clock that counts up', () => {
    const [warmUp, , plyo, accels] = liveBlocks(session(3, 'speed'))
    expect(warmUp.checklist).toEqual([])
    expect(plyo).toMatchObject({ seconds: null, work: false })
    expect(plyo.checklist).toEqual([
      'Pogo jumps 15 · set 1 of 2',
      'Pogo jumps 15 · set 2 of 2',
      'Broad jumps 3 · set 1 of 3',
      'Broad jumps 3 · set 2 of 3',
      'Broad jumps 3 · set 3 of 3',
    ])
    expect(accels.checklist).toEqual(['Accelerations · 1 of 4', 'Accelerations · 2 of 4', 'Accelerations · 3 of 4', 'Accelerations · 4 of 4'])
    const run = plyometrics()
    expect(blockLeft(run, at(12))).toBeNull()
    expect(blockElapsed(run, at(12))).toBe(120)
    expect(advance(run, at(40))).toBe(run)
  })

  it('shows the reduced jumps of a Deload and the Taper, and a Substitution’s amount', () => {
    const plyo = (s: Session) => liveBlocks(s).find((b) => b.name === 'Plyometrics')!.checklist
    expect(plyo(session(7, 'speed'))).toEqual(['Pogo jumps 15', 'Broad jumps 2 · set 1 of 2', 'Broad jumps 2 · set 2 of 2'])
    expect(plyo(session(25, 'speed'))).toEqual(['Pogo jumps 10'])
    expect(plyo(equip(session(3, 'speed'), []))).toEqual(['Sled push sprints 10–15 m', 'Sled push sprints 10–15 m'])
    const bike = { ...session(3, 'speed'), blocks: session(3, 'speed').blocks.map((b) => ({ ...b, exercises: b.exercises.map((e) => (e.name === 'Pogo jumps' ? e.substitutions![0].options[1] : e)) })) }
    expect(plyo(bike)).toEqual(['Bike sprints 8–10″', 'Broad jumps 3 · set 1 of 3', 'Broad jumps 3 · set 2 of 3', 'Broad jumps 3 · set 3 of 3'])
  })

  it('leaves Drills and Accelerations rows as they were', () => {
    const [, drills, , accels] = liveBlocks(session(3, 'speed'))
    expect(drills.checklist.slice(0, 3)).toEqual(['Leg swings 10 / leg', 'A-skips 20 m · 1 of 2', 'A-skips 20 m · 2 of 2'])
    expect(accels.checklist[0]).toBe('Accelerations · 1 of 4')
  })

  it('ticks and unticks sets, and ends the Block on the last one', () => {
    let run = plyometrics()
    run = tick(run, 0, at(11))
    run = tick(run, 1, at(11))
    run = tick(run, 1, at(11.5))
    expect(run.ticked).toEqual([0])
    for (const row of [1, 2, 3]) run = tick(run, row, at(12))
    expect(run.block).toBe(2)
    run = tick(run, 4, at(13))
    // On to Accelerations, its sets unticked; the ticks were never a log.
    expect(run).toMatchObject({
      block: 3,
      ticked: [],
      skipped: [],
      splits: [],
      cutShort: [
        { block: 1, seconds: 180 },
        { block: 2, seconds: 180 },
      ],
    })
    expect(canUndo(run, at(13))).toBe(true)
  })

  it('ends with Done before every set is ticked, still not skipped', () => {
    const run = nextBlock(tick(plyometrics(), 0, at(11)), at(12))
    expect(run).toMatchObject({
      block: 3,
      skipped: [],
      splits: [],
      cutShort: [
        { block: 1, seconds: 180 },
        { block: 2, seconds: 120 },
      ],
    })
    expect(liveStatus(advance(tap(run, at(13)), at(40)))).toBe('done')
  })
})

describe('the Ready screen', () => {
  it('holds the first rep after the warm-up until Start, and the wait isn’t active time', () => {
    let run = advance(start(session(3, 'threshold')), at(12))
    expect(run).toMatchObject({ block: 1, ready: true, pausedAt: at(10) })
    expect(blockLeft(run, at(13))).toBe(720)
    expect(advance(run, at(30))).toBe(run)

    run = resume(run, at(13))
    expect(run).toMatchObject({ ready: false, pausedAt: null })
    expect(blockLeft(run, at(14))).toBe(660)
    run = advance(run, at(60))
    expect(liveLog(run, at(60), { id: 'x', rpe: 7, distanceMeters: null, resultSeconds: null, updatedAt: '' }).minutes).toBe(45)
  })

  it('shows after Done or Skip block too, and stays on Ready through End and Keep going', () => {
    let run = nextBlock(start(session(3, 'threshold')), at(4))
    expect(run).toMatchObject({ block: 1, ready: true, pausedAt: at(4) })
    run = resume(end(run, at(5)), at(6))
    expect(run).toMatchObject({ ending: false, ready: true, pausedAt: at(4) })
  })

  it('never holds between reps and recoveries', () => {
    const run = advance(go(start(session(3, 'speed')), at(10)), at(10))
    // Warm-up, then the checklist Blocks tapped through: Rep 1 holds, then the set flows.
    let r = go(nextBlock(nextBlock(nextBlock(run, at(10)), at(12)), at(14)), at(14))
    expect(r.block).toBe(4)
    r = advance(r, at(14 + 3 + 1.5 + 1))
    expect(r).toMatchObject({ block: 6, ready: false, pausedAt: null })
  })

  it('holds before each HYROX round, and only before the first run of a Race simulation', () => {
    let hyrox = startRun({ week: 1, session: session(1, 'hyrox'), date: localDate('2026-10-28'), environment: 'indoor' }, T0)
    hyrox = nextBlock(nextBlock(advance(hyrox, at(5)), at(6)), at(7))
    expect(hyrox).toMatchObject({ block: 3, ready: true })
    hyrox = nextBlock(nextBlock(nextBlock(resume(hyrox, at(8)), at(11)), at(14)), at(18))
    expect(hyrox).toMatchObject({ block: 4, ready: true, pausedAt: at(18) })

    let sim = startRun({ week: 17, session: session(17, 'race-simulation'), date: localDate('2027-02-17'), environment: 'indoor' }, T0)
    sim = advance(sim, at(10))
    expect(sim).toMatchObject({ block: 1, ready: true })
    sim = nextBlock(resume(sim, at(10)), at(14))
    expect(sim).toMatchObject({ block: 2, ready: false, pausedAt: null })
  })
})

describe('Undo', () => {
  it('restores the Block skipped, its clock still running from where it was', () => {
    const before = go(start(session(3, 'threshold')), at(10))
    const skipped = nextBlock(before, at(12))
    expect(canUndo(skipped, at(12.1))).toBe(true)
    const back = undo(skipped, at(12.1))
    expect(back).toMatchObject({ block: 1, skipped: [], asks: [], cutShort: [], undo: null })
    // The seconds since the tap count toward Rep 1.
    expect(blockElapsed(back, at(12.1))).toBe(126)
  })

  it('restores a Block ended with Done, from the Ready screen or after Start', () => {
    const done = nextBlock(start(session(3, 'threshold')), at(5))
    const started = resume(done, at(5.05))
    for (const run of [done, started]) {
      const back = undo(run, at(5.1))
      expect(back).toMatchObject({ block: 0, ready: false, pausedAt: null })
      expect(blockElapsed(back, at(5.1))).toBe(306)
    }
  })

  it('lasts about 8 seconds, and goes once something else is recorded', () => {
    const skipped = nextBlock(go(start(session(3, 'threshold')), at(10)), at(12))
    expect(canUndo(skipped, at(12) + 7_900)).toBe(true)
    expect(canUndo(skipped, at(12) + 8_100)).toBe(false)
    expect(undo(skipped, at(12) + 8_100)).toBe(skipped)
    expect(canUndo(answer(skipped, 1, 292, null), at(12))).toBe(false)
  })
})

describe('going back to an earlier Block', () => {
  /** Threshold on Rep 2, 30 s in: Rep 1 skipped at 11 of 12 minutes. */
  const onRep2 = () => {
    let run = go(start(session(3, 'threshold')), at(10))
    run = nextBlock(run, at(21))
    run = advance(run, at(23.5))
    return run
  }

  it('resumes a Block cut short where it was left, and drops what was recorded from it on', () => {
    const run = onRep2()
    expect(run.block).toBe(3)
    expect(redone(run, 1)).toEqual([1])
    const back = goBack(run, 1, at(24))
    expect(back).toMatchObject({ block: 1, skipped: [], asks: [], cutShort: [], intervals: [], ready: false })
    expect(blockElapsed(back, at(24))).toBe(660)
    // Every minute since Start that wasn't paused still counts.
    expect(liveLog(back, at(24), { id: 'x', rpe: 7, distanceMeters: null, resultSeconds: null, updatedAt: '' }).minutes).toBe(24)
  })

  it('restarts a timed Block that ran its time, and keeps what earlier Blocks recorded', () => {
    let run = advance(go(start(session(3, 'threshold')), at(10)), at(36))
    run = answer(run, 1, 292, null)
    expect(run.block).toBe(4)
    expect(redone(run, 2)).toEqual([3])
    const back = goBack(run, 2, at(36))
    expect(back).toMatchObject({ block: 2, intervals: [{ block: 1 }], asks: [] })
    expect(blockElapsed(back, at(36))).toBe(0)
    expect(redone(run, 0)).toEqual([1, 3])
  })

  it('picks a Block run to a distance up from its split', () => {
    const run = nextBlock(onFiveK(start(session(2, '5k-test'))), at(34.5))
    const back = goBack(run, 2, at(35))
    expect(back).toMatchObject({ block: 2, splits: [] })
    expect(blockElapsed(back, at(35))).toBe(22 * 60 + 30)
  })

  it('needs nothing confirmed when nothing recorded would be lost', () => {
    const run = advance(start(session(3, 'threshold')), at(10))
    expect(redone(run, 0)).toEqual([])
    expect(goBack(run, 0, at(11))).toMatchObject({ block: 0, pausedAt: null })
    expect(goBack(run, 1, at(11))).toBe(run)
  })
})

describe('the finish sheet', () => {
  it('lists the work cut short, and one tap flips the log to Done', () => {
    let run = go(start(session(3, 'threshold')), at(10))
    run = nextBlock(run, at(21.5))
    run = end(advance(run, at(36)), at(36))
    expect(liveStatus(run)).toBe('partial')
    expect(shortBlocks(run)).toEqual([{ block: 1, seconds: 690 }])
    const flipped = markDone(run, true)
    expect(liveStatus(flipped)).toBe('done')
    expect(liveStatus(markDone(flipped, false))).toBe('partial')
  })

  it('lists the work never reached, and the time run on the Block it ended in', () => {
    const run = end(advance(go(start(session(3, 'threshold')), at(10)), at(15)), at(15))
    expect(shortBlocks(run)).toEqual([
      { block: 1, seconds: 300 },
      { block: 3, seconds: null },
    ])
  })
})

describe('liveLog', () => {
  const input = { id: 'live-1234', rpe: 7, distanceMeters: 9400, resultSeconds: null, updatedAt: '2026-11-11T18:00:00.000Z' }

  it('logs a Session run to the end as Done, with its time, Environment, distance and reps', () => {
    let run = pause(advance(start(session(3, 'threshold')), at(5)), at(5))
    run = advance(go(resume(run, at(7)), at(12)), at(60))
    run = answer(run, 1, 292, null)
    expect(liveLog(run, at(60), input)).toEqual({
      id: 'live-1234',
      week: 3,
      sessionId: 'threshold',
      date: '2026-11-11',
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
      updatedAt: '2026-11-11T18:00:00.000Z',
    })
  })

  it('is Partial when a rep was skipped or the Session ended before the reps were done', () => {
    const skipped = advance(go(nextBlock(go(start(session(3, 'threshold')), at(10)), at(11)), at(11)), at(60))
    expect(liveLog(skipped, at(60), input).status).toBe('partial')
    const ended = end(advance(go(start(session(3, 'threshold')), at(10)), at(20)), at(20))
    expect(liveLog(ended, at(25), input)).toMatchObject({ status: 'partial', minutes: 20 })
    const inCooldown = end(advance(go(start(session(3, 'threshold')), at(10)), at(40)), at(40))
    expect(liveLog(inCooldown, at(40), input).status).toBe('done')
  })

  it('keeps a 5K test’s time only when the 5 km was covered, and the console distance only indoors', () => {
    const covered = nextBlock(onFiveK(start(session(2, '5k-test'), 'outdoor')), at(34.5))
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

  it('keeps an Undo, and takes back a run stored before Done, Ready and Undo', () => {
    const skipped = nextBlock(go(start(session(3, 'threshold')), at(10)), at(12))
    expect(parseLiveRun(JSON.parse(JSON.stringify(skipped)))).toEqual(skipped)

    const { ready: _r, cutShort: _c, ticked: _t, undo: _u, markedDone: _m, ...old } = advance(start(session(3, 'threshold')), at(5))
    const blocks = old.blocks.map(({ checklist: _, ...b }) => b)
    const parsed = parseLiveRun(JSON.parse(JSON.stringify({ ...old, blocks })))!
    expect(parsed).toMatchObject({ block: 0, ready: false, cutShort: [], ticked: [], undo: null, markedDone: false })
    expect(parsed.blocks[0].checklist).toEqual([])
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

  it('runs warm-up, lunges, Set up, three rounds on a clock that counts up, and the cooldown', () => {
    expect(liveBlocks(session(1, 'hyrox')).map((b) => [b.name, b.kind, b.seconds, b.round, b.work])).toEqual([
      ['Warm-up', 'warm-up', 300, null, false],
      ['Lunges', 'drills', null, null, false],
      ['Set up', 'setup', null, null, false],
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
    expect(layout(6)).toEqual([
      '700 m: sled-push 25 m, sled-pull 25 m, farmers-carry 100 m',
      '700 m: sandbag-lunges 50 m, sled-push 25 m',
      '700 m: sled-pull 25 m, farmers-carry 100 m, sandbag-lunges 50 m',
    ])
    expect(layout(18)).toEqual(['800 m: skierg 500 m, burpee-broad-jumps 40 m', '800 m: row 500 m, wall-balls 50 reps', '800 m: skierg 500 m'])
    expect(layout(22)).toEqual(['1000 m: sled-push 50 m', '1000 m: sled-pull 50 m', '1000 m: sandbag-lunges 100 m'])
  })

  it('cuts a Deload week to a two-round technique circuit', () => {
    expect(layout(7)).toEqual(['700 m: skierg 300 m, burpee-broad-jumps 20 m, wall-balls 30 reps', '700 m: row 300 m, wall-balls 30 reps'])
  })

  it.each([
    // Week, Phase and share of Race load: plate weight on the sleds, per hand on the farmers carry, to the nearest 5 lb.
    [1, 'Foundation, 60%', { 'sled-push': 200, 'sled-pull': 135, 'farmers-carry': 30, 'sandbag-lunges': 25 }],
    [6, '5K development, 70%', { 'sled-push': 235, 'sled-pull': 160, 'farmers-carry': 35, 'sandbag-lunges': 30 }],
    [10, '5K development, 75%', { 'sled-push': 250, 'sled-pull': 170, 'farmers-carry': 40, 'sandbag-lunges': 35 }],
    [12, '5K development, 80%', { 'sled-push': 270, 'sled-pull': 180, 'farmers-carry': 40, 'sandbag-lunges': 35 }],
    [14, 'HYROX build, 90%', { 'sled-push': 300, 'sled-pull': 205, 'farmers-carry': 50, 'sandbag-lunges': 40 }],
    [19, 'HYROX build, 100%', { 'sled-push': 335, 'sled-pull': 225, 'farmers-carry': 55, 'sandbag-lunges': 45 }],
    [22, 'Race specific, 100%', { 'sled-push': 335, 'sled-pull': 225, 'sandbag-lunges': 45 }],
  ])('loads Week %i (%s) from Race load', (week, _, pounds) => {
    expect(loads(rounds(week))).toEqual(pounds)
  })

  it('never scales the wall ball, and gives Stations without a load no pounds', () => {
    expect(loads(rounds(2))).toEqual({ skierg: null, 'burpee-broad-jumps': null, row: null, 'wall-balls': 13 })
    expect(loads(rounds(18))['wall-balls']).toBe(13)
  })

  it('times each leg of a round from a tap at its end: the run, then each Station', () => {
    let run = onRound1(startRun({ week: 1, session: session(1, 'hyrox'), date: localDate('2026-10-28'), environment: 'indoor' }, T0))
    expect(run.blocks[run.block].name).toBe('Round 1 of 3')
    expect(roundLegs(run.blocks[run.block])).toEqual(['run', 'sled-push', 'sled-pull'])
    expect(blockLeft(run, at(9))).toBeNull()
    expect(currentLeg(run)).toBe(0)

    // The run in 3:00: the round goes on, onto the sled push, its clock from zero.
    run = nextBlock(run, at(10))
    expect(run).toMatchObject({ block: 3, legs: [{ block: 3, seconds: 180 }], asks: [] })
    expect(currentLeg(run)).toBe(1)
    expect(legElapsed(run, at(11))).toBe(60)
    expect(blockElapsed(run, at(11))).toBe(240)
    // A second tap a moment later is the same thumb bouncing: nothing happens.
    expect(nextBlock(run, at(10) + 1500)).toBe(run)

    run = nextBlock(run, at(13.5))
    expect(currentLeg(run)).toBe(2)
    run = tap(run, at(17))
    expect(run.legs).toEqual([{ block: 3, seconds: 180 }, { block: 3, seconds: 210 }, { block: 3, seconds: 210 }])
    expect(run.splits).toEqual([{ block: 3, seconds: 600 }])
    expect(run.asks).toEqual([3])
    // Round 1 was heavy: the sled push went down to 180 lb and the run was 500 m.
    const [push, pull] = run.blocks[3].stations
    run = answerStations(run, 3, { runMeters: 500, stations: [{ ...push, pounds: 180 }, pull] })
    expect(run.asks).toEqual([])
    // The lighter sled push carries on to round 3; round 2 has no sled push, and Set up keeps the load it was set up with.
    expect(run.blocks[2].stations[0].pounds).toBe(200)
    expect(run.blocks[5].stations[0]).toEqual({ station: 'sled-push', meters: 25, reps: null, pounds: 180 })

    run = legs(run, 20.5, 24, 28.5)
    // Round 2 is never answered: it logs as written.
    run = legs(run, 31.75, 35.5, 39)
    run = advance(run, at(44))
    expect(isOver(run)).toBe(true)

    expect(stationLogs(run)).toEqual([
      { round: 1, part: 'round', pounds: null, meters: null, reps: null, seconds: 600 },
      { round: 1, part: 'run', pounds: null, meters: 500, reps: null, seconds: 180 },
      { round: 1, part: 'sled-push', pounds: 180, meters: 25, reps: null, seconds: 210 },
      { round: 1, part: 'sled-pull', pounds: 135, meters: 25, reps: null, seconds: 210 },
      { round: 2, part: 'round', pounds: null, meters: null, reps: null, seconds: 690 },
      { round: 2, part: 'run', pounds: null, meters: 600, reps: null, seconds: 210 },
      { round: 2, part: 'farmers-carry', pounds: 30, meters: 50, reps: null, seconds: 210 },
      { round: 2, part: 'sandbag-lunges', pounds: 25, meters: 25, reps: null, seconds: 270 },
      { round: 3, part: 'round', pounds: null, meters: null, reps: null, seconds: 630 },
      { round: 3, part: 'run', pounds: null, meters: 600, reps: null, seconds: 195 },
      { round: 3, part: 'sled-push', pounds: 180, meters: 25, reps: null, seconds: 225 },
      { round: 3, part: 'sled-pull', pounds: 135, meters: 25, reps: null, seconds: 210 },
    ])
    const input = { id: 'hyrox-1234', rpe: 7, distanceMeters: 1800, resultSeconds: null, updatedAt: '2026-10-28T18:00:00.000Z' }
    // 44 minutes on the clock, less the minute setting up.
    expect(liveLog(run, at(44), input)).toMatchObject({ status: 'done', minutes: 43, distanceMeters: null, stations: stationLogs(run) })
  })

  it('logs only the rounds finished, Partial, when it ends early', () => {
    let run = startRun({ week: 1, session: session(1, 'hyrox'), date: localDate('2026-10-28'), environment: 'outdoor' }, T0)
    run = end(nextBlock(nextBlock(nextBlock(onRound1(run), at(10)), at(14)), at(18)), at(25))
    // Round 2's run was done, but the round wasn't.
    run = { ...run, legs: [...run.legs, { block: 4, seconds: 200 }] }
    expect(stationLogs(run).filter((l) => l.part === 'round')).toEqual([
      { round: 1, part: 'round', pounds: null, meters: null, reps: null, seconds: 660 },
    ])
    expect(liveStatusOf(run)).toBe('partial')
  })

  it('goes back to a round on its last leg, the Stations before it kept', () => {
    let run = onRound1(startRun({ week: 1, session: session(1, 'hyrox'), date: localDate('2026-10-28'), environment: 'indoor' }, T0))
    run = legs(run, 10, 13.5, 17)
    run = nextBlock(run, at(20))
    run = goBack(run, 3, at(21))
    expect(run).toMatchObject({ block: 3, splits: [], legs: [{ block: 3, seconds: 180 }, { block: 3, seconds: 210 }] })
    expect(currentLeg(run)).toBe(2)
    // The sled pull's clock runs on from its 3:30.
    expect(legElapsed(run, at(22))).toBe(270)
    expect(redone(nextBlock(run, at(23)), 3)).toEqual([3])
  })

  it('logs only the round time for a round finished before legs were timed', () => {
    let run = onRound1(startRun({ week: 1, session: session(1, 'hyrox'), date: localDate('2026-10-28'), environment: 'indoor' }, T0))
    run = legs(run, 10, 13.5, 17)
    const old = { ...run, legs: [] }
    expect(stationLogs(old).filter((l) => l.round === 1).map((l) => [l.part, l.seconds])).toEqual([
      ['round', 600],
      ['run', null],
      ['sled-push', null],
      ['sled-pull', null],
    ])
  })

  it('asks about a split quicker than anyone could go, and saves it put right or untimed', () => {
    let run = onRound1(startRun({ week: 18, session: session(18, 'hyrox'), date: localDate('2027-02-24'), environment: 'indoor' }, T0))
    // 0:14 for 800 m: the run's tap slipped. The SkiErg took the rest of it.
    run = nextBlock(run, at(7) + 14_000)
    run = nextBlock(run, at(14))
    run = tap(run, at(20))
    expect(quickSplits(run)).toEqual([
      { block: run.blocks.findIndex((b) => b.round === 1), leg: 0, seconds: 14, part: 'run', round: 1, meters: 800, reps: null, fastest: 96 },
    ])
    const [{ block }] = quickSplits(run)
    const line = (fixes: SplitFix[]) => stationLogs(run, fixes).find((l) => l.round === 1 && l.part === 'run')!.seconds
    expect(line([{ block, leg: 0, seconds: 200 }])).toBe(200)
    expect(line([{ block, leg: 0, seconds: null }])).toBeNull()
    const input = { id: 'hyrox-1234', rpe: 8, distanceMeters: null, resultSeconds: null, updatedAt: '', fixes: [{ block, leg: 0, seconds: 200 }] }
    expect(liveLog(run, at(30), input).stations.find((l) => l.part === 'run')!.seconds).toBe(200)
  })

  it.each([
    ['run', 800, null, 96],
    ['skierg', 500, null, 75],
    ['sled-push', 25, null, 10],
    ['wall-balls', null, 50, 50],
  ] as const)('no %s of %s m or %s reps goes under %i s', (part, meters, reps, fastest) => {
    expect(fastestSplit(part, meters, reps)).toBe(fastest)
  })
})

describe('split warm-ups and the HYROX Set up', () => {
  it('jogs Speed’s warm-up for 7 minutes, then ticks off its Drills', () => {
    const [warmUp, drills, plyo] = liveBlocks(session(3, 'speed'))
    expect(warmUp).toMatchObject({ name: 'Warm-up', kind: 'warm-up', seconds: 420, detail: [], checklist: [] })
    expect(drills).toMatchObject({ name: 'Drills', kind: 'drills', seconds: null, work: false })
    expect(drills.checklist).toEqual([
      'Leg swings 10 / leg',
      'A-skips 20 m · 1 of 2',
      'A-skips 20 m · 2 of 2',
      'B-skips 20 m · 1 of 2',
      'B-skips 20 m · 2 of 2',
      'High knees 20 m',
      'Butt kicks 20 m',
    ])
    expect(plyo.name).toBe('Plyometrics')
    expect(liveBlocks(session(4, 'speed'))[1].name).toBe('Drills')
  })

  it('jogs the 5K test’s warm-up for 10 minutes, then ticks off 4 strides', () => {
    const test = liveBlocks(session(2, '5k-test'))
    expect(test.map((b) => [b.name, b.kind, b.seconds])).toEqual([
      ['Warm-up', 'warm-up', 600],
      ['Strides', 'drills', null],
      ['5 km', 'distance', null],
      ['Cooldown', 'cooldown', 480],
    ])
    expect(test[1].checklist).toEqual(['Strides · 1 of 4', 'Strides · 2 of 4', 'Strides · 3 of 4', 'Strides · 4 of 4'])
  })

  it('jogs HYROX’s warm-up for 5 minutes, ticks off the Lunges, then sets up every Station at its load', () => {
    const blocks = liveBlocks(session(1, 'hyrox'))
    expect(blocks.slice(0, 4).map((b) => [b.name, b.kind, b.seconds, b.work])).toEqual([
      ['Warm-up', 'warm-up', 300, false],
      ['Lunges', 'drills', null, false],
      ['Set up', 'setup', null, false],
      ['Round 1 of 3', 'round', null, true],
    ])
    expect(blocks[1].checklist).toEqual(['Lunges 10 · 1 of 2', 'Lunges 10 · 2 of 2'])
    expect(blocks[2]).toMatchObject({ checklist: [], round: null, effort: null })
    expect(blocks[2].stations).toEqual([
      { station: 'sled-push', meters: null, reps: null, pounds: 200 },
      { station: 'sled-pull', meters: null, reps: null, pounds: 135 },
      { station: 'farmers-carry', meters: null, reps: null, pounds: 30 },
      { station: 'sandbag-lunges', meters: null, reps: null, pounds: 25 },
    ])
    expect(blocks[2].detail).toEqual([])
  })

  it('sets up only the Stations with a load, and says once that nothing else needs loading', () => {
    const setUp = liveBlocks(session(2, 'hyrox')).find((b) => b.kind === 'setup')!
    expect(setUp.stations).toEqual([{ station: 'wall-balls', meters: null, reps: null, pounds: 13 }])
    expect(setUp.detail).toEqual(['Nothing else to load.'])
  })

  const hyrox = () => startRun({ week: 1, session: session(1, 'hyrox'), date: localDate('2026-10-28'), environment: 'indoor' }, T0)
  /** On Set up, a minute after the warm-up: both sets of lunges ticked. */
  const onSetUp = () => tick(tick(advance(hyrox(), at(5)), 0, at(5.5)), 1, at(6))

  it('runs Set up on a stopwatch that ends with Done, then holds round 1 on Ready', () => {
    let run = onSetUp()
    expect(run).toMatchObject({ block: 2, ready: false, pausedAt: null })
    expect(blockLeft(run, at(9))).toBeNull()
    expect(blockElapsed(run, at(9))).toBe(180)
    expect(advance(run, at(40))).toBe(run)

    run = nextBlock(run, at(12))
    expect(run).toMatchObject({ block: 3, ready: true, pausedAt: at(12), skipped: [], splits: [] })
    expect(canUndo(run, at(12) + 5000)).toBe(true)
    expect(undo(run, at(12) + 5000)).toMatchObject({ block: 2, ready: false })
  })

  it('leaves Set up out of the active time and the log’s minutes', () => {
    let run = nextBlock(onSetUp(), at(12))
    run = resume(run, at(13))
    for (const t of [23, 33, 43]) run = legs(run, t - 6, t - 3, t)
    run = advance(run, at(48))
    expect(isOver(run)).toBe(true)
    // 48 minutes on the clock, less a minute on Ready and six setting up.
    expect(activeSeconds(run, at(48))).toBe(41 * 60)
    expect(liveLog(run, at(48), { id: 'x', rpe: 7, distanceMeters: null, resultSeconds: null, updatedAt: '' }).minutes).toBe(41)
  })

  it('leaves Set up out of the active time when the Session ends during it', () => {
    const run = end(onSetUp(), at(10))
    expect(activeSeconds(run, at(10))).toBe(6 * 60)
    expect(activeSeconds(goBack(nextBlock(onSetUp(), at(12)), 2, at(14)), at(15))).toBe(6 * 60)
  })
})

const liveStatusOf = (run: LiveRun) => liveLog(run, at(60), { id: 'x', rpe: 7, distanceMeters: null, resultSeconds: null, updatedAt: '' }).status

describe('Race simulations', () => {
  const sim = (week: number) => liveBlocks(session(week, 'race-simulation'))
  const legs = (week: number) =>
    sim(week)
      .filter((b) => b.round !== null)
      .map((b) => (b.kind === 'distance' ? `run ${b.meters} m` : `${b.stations[0].station} ${b.stations[0].meters ?? b.stations[0].reps} @ ${b.stations[0].pounds}`))

  it('runs Week 17 as half simulation A: a split for each 1 km run and each of Stations 1–4, in race order', () => {
    expect(sim(17).map((b) => [b.name, b.kind, b.seconds])).toEqual([
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
    expect(legs(17)).toEqual([
      'run 1000 m', 'skierg 1000 @ null', 'run 1000 m', 'sled-push 50 @ 335', 'run 1000 m', 'sled-pull 50 @ 225', 'run 1000 m',
      'burpee-broad-jumps 80 @ null',
    ])
  })

  it('runs Week 20 as half simulation B over Stations 5–8 at race volume', () => {
    expect(legs(20)).toEqual([
      'run 1000 m', 'row 1000 @ null', 'run 1000 m', 'farmers-carry 200 @ 55', 'run 1000 m', 'sandbag-lunges 100 @ 45', 'run 1000 m',
      'wall-balls 100 @ 13',
    ])
  })

  it('runs Week 23 as eight full 1 km runs with every Station at half race volume and Race load', () => {
    expect(legs(23)).toEqual([
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
    let run = startRun({ week: 17, session: session(17, 'race-simulation'), date: localDate('2027-02-17'), environment: 'indoor' }, T0)
    run = go(run, at(10))
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
    const run = nextBlock(onRound1(startRun({ week: 1, session: session(1, 'hyrox'), date: localDate('2026-10-28'), environment: 'indoor' }, T0)), at(10))
    expect(run.legs).toHaveLength(1)
    expect(parseLiveRun(JSON.parse(JSON.stringify(run)))).toEqual(run)
  })

  it('takes back one stored before rounds were timed leg by leg, on the round’s first leg', () => {
    const { legs: _, ...old } = onRound1(startRun({ week: 1, session: session(1, 'hyrox'), date: localDate('2026-10-28'), environment: 'indoor' }, T0))
    const parsed = parseLiveRun(JSON.parse(JSON.stringify(old)))!
    expect(parsed.legs).toEqual([])
    expect(currentLeg(parsed)).toBe(0)
  })
})

describe('sessionRpe', () => {
  it('guesses a Session’s Overall RPE as Live’s finish sheet does, for every Session of a Week', () => {
    for (const s of findWeek(program, 3)!.sessions) expect(sessionRpe(s)).toBe(predictedRpe(start(s)))
    expect(sessionRpe(session(3, 'easy'))).toBeLessThan(sessionRpe(session(3, 'speed')))
  })
})
