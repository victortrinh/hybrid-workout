import { describe, expect, it } from 'vitest'
import { localDate } from './calendar'
import { findWeek } from './coach'
import { equip } from './equipment'
import {
  advance,
  answer,
  blockElapsed,
  canKeepGoing,
  canUndo,
  goBack,
  keepGoing,
  markDone,
  redone,
  shortBlocks,
  tick,
  undo,
  endRest,
  restLeft,
  answerStations,
  blockLeft,
  end,
  hasByFeelReps,
  heldUnanswered,
  isLive,
  isLiveRun,
  isOver,
  liveBlocks,
  liveStatus,
  liveLog,
  liveTarget,
  byFeelHint,
  byFeelPrefill,
  loggedSpeeds,
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
import type { SessionLog } from './log'
import { clock, trainingPaces, type RunContext } from './paces'
import { program } from './program/program'
import type { Exercise, RunEffort, Session, Substitution } from './program/types'

const session = (week: number, id: string): Session => {
  const found = findWeek(program, week)?.sessions.find((s) => s.id === id)
  if (!found) throw new Error(`No ${id} in Week ${week}`)
  return found
}

// ---------------------------------------------------------------------------
// Clock fixtures. The Live run clock doesn't care which Session it runs, so
// its mechanics are pinned on fixed shapes rather than on Program Weeks that
// move whenever the plan does: a two-rep Threshold set, a run with drills,
// jumps and accelerations to tick (by feel, paced, Deload and Taper), and a
// run to a distance.

const easyJog = (minutes: number, name = 'Easy jog'): Exercise => ({
  name,
  prescription: { kind: 'run', minutes, effort: { pace: 'easy', rpe: [2, 4] } },
})

/** 2 × 12′ at Threshold with a 2′ jog: warm-up 10, reps 26, easy and cooldown 9. */
const THRESHOLD: Session = {
  id: 'run',
  type: 'run',
  headline: '2 × 12′',
  minutes: 45,
  key: true,
  optional: false,
  blocks: [
    { name: 'Warm-up', minutes: 10, exercises: [easyJog(10)] },
    {
      name: 'Threshold',
      minutes: 26,
      main: true,
      exercises: [
        {
          name: 'Threshold reps',
          prescription: { kind: 'intervals', reps: 2, workSeconds: 720, recoverySeconds: 120, recovery: 'jog', effort: { pace: 'threshold', rpe: [6, 7] } },
        },
      ],
    },
    { name: 'Easy and cooldown', minutes: 9, exercises: [easyJog(9)] },
  ],
}

const floor: Substitution = {
  when: ['no-floor-space'],
  options: [
    { name: 'Sled push sprints', prescription: { kind: 'sprints', meters: [10, 15], light: true } },
    { name: 'Bike sprints', prescription: { kind: 'sprints', seconds: [8, 10] } },
  ],
}
const jumps = (name: string, sets: number, reps: number, rest: number): Exercise => ({
  name,
  prescription: { kind: 'sets', sets, reps, load: { kind: 'bodyweight' }, restSeconds: [rest, rest] },
  substitutions: [floor],
})
const drill = (name: string, sets: number, amount: { reps?: number; meters?: number; perLeg?: boolean }): Exercise => ({
  name,
  prescription: { kind: 'drill', sets, ...amount },
})

type DrillsRun = 'by-feel' | 'paced' | 'deload' | 'taper'

/**
 * A run with a jog, Drills, Plyometrics and Accelerations before its reps: by
 * feel (5 × 3′ hard), paced (the same at Threshold), a Deload (4 × 2′
 * controlled, fewer jumps) and a Taper (one pogo set, no accelerations).
 */
function drillsRun(kind: DrillsRun): Session {
  const light = kind === 'deload' || kind === 'taper'
  const effort: RunEffort = kind === 'by-feel' ? { feel: 'hard' } : kind === 'deload' ? { feel: 'controlled' } : { pace: 'threshold' }
  const [reps, work, recovery] = light ? [4, 120, 120] : [5, 180, 90]
  return {
    id: 'run',
    type: 'run',
    headline: `${reps} reps`,
    minutes: 45,
    key: false,
    optional: false,
    blocks: [
      { name: 'Warm-up', minutes: 7, exercises: [easyJog(7)] },
      {
        name: 'Drills',
        minutes: 3,
        exercises: [
          drill('Leg swings', 1, { reps: 10, perLeg: true }),
          drill('A-skips', 2, { meters: 20 }),
          drill('B-skips', 2, { meters: 20 }),
          drill('High knees', 1, { meters: 20 }),
          drill('Butt kicks', 1, { meters: 20 }),
        ],
      },
      {
        name: 'Plyometrics',
        minutes: 5,
        exercises:
          kind === 'taper'
            ? [jumps('Pogo jumps', 1, 10, 60)]
            : kind === 'deload'
              ? [jumps('Pogo jumps', 1, 15, 60), jumps('Broad jumps', 2, 2, 20)]
              : [jumps('Pogo jumps', 2, 15, 60), jumps('Broad jumps', 3, 3, 20)],
      },
      ...(kind === 'taper'
        ? []
        : [
            {
              name: 'Accelerations',
              minutes: 5,
              exercises: [
                {
                  name: 'Accelerations',
                  prescription: { kind: 'accelerations' as const, reps: light ? 2 : 4, meters: 15, percentOfMax: [80, 90] as const, restSeconds: [45, 45] as const },
                  substitutions: [floor],
                },
              ],
            },
          ]),
      {
        name: 'Intervals',
        minutes: 20,
        main: true,
        exercises: [{ name: 'Intervals', prescription: { kind: 'intervals', reps, workSeconds: work, recoverySeconds: recovery, recovery: 'jog', effort } }],
      },
      { name: 'Cooldown', minutes: 5, exercises: [easyJog(5, 'Jog or walk')] },
    ],
  }
}

/** A run to a distance: a 10′ jog, 4 strides to tick, 5 km all-out, an 8′ cooldown. */
const DISTANCE_RUN: Session = {
  id: 'distance-run',
  type: 'run',
  headline: '5 km',
  minutes: 45,
  key: false,
  optional: false,
  blocks: [
    { name: 'Warm-up', minutes: 10, exercises: [easyJog(10)] },
    { name: 'Strides', minutes: 2, exercises: [{ name: 'Strides', prescription: { kind: 'strides', reps: 4, seconds: 15 } }] },
    { name: '5 km', main: true, exercises: [{ name: '5 km', prescription: { kind: 'run', meters: 5000, effort: { feel: 'all-out' } } }] },
    { name: 'Cooldown', minutes: 8, exercises: [easyJog(8)] },
  ],
}

const MIN = 60_000
const T0 = Date.parse('2026-11-11T17:00:00Z')
const at = (minutes: number) => T0 + minutes * MIN

/** Paces estimated from 23:00: Threshold 4:52/km, 12.3 km/h. */
const paces = trainingPaces(307)
const indoor: RunContext = { paces, environment: 'indoor', unit: 'kmh' }

const start = (s: Session, environment: 'indoor' | 'outdoor' = 'indoor'): LiveRun =>
  startRun({ week: 3, session: s, date: localDate('2026-11-11'), environment }, T0)

/** The clock caught up to `now`, and Start tapped at once if it holds on a Ready screen. */
const go = (run: LiveRun, now: number) => resume(advance(run, now), now)
/** Skip block, Done or Finished, then Start at once if the next Block holds on Ready. */
const tap = (run: LiveRun, now: number) => resume(nextBlock(run, now), now)
/** The run to a distance on its 5 km at minute 12: the jog ran its 10, the strides were Done at 12, Start at once. */
const onDistance = (run: LiveRun) => tap(advance(run, at(10)), at(12))
/** A HYROX session on round 1 at minute 7: the jog ran its 5, Set up Done at 7, Start at once. */
const onRound1 = (run: LiveRun) => tap(advance(run, at(5)), at(7))
/** A HYROX round, a tap at the end of each leg; the last one ends the round and Starts the next on Ready. */
const legs = (run: LiveRun, ...taps: number[]) =>
  taps.reduce((next, t, i) => (i === taps.length - 1 ? tap(next, at(t)) : nextBlock(next, at(t))), run)

describe('liveBlocks', () => {
  it('lays the Run’s Threshold reps out as warm-up, reps with jogs between, then the cooldown', () => {
    const blocks = liveBlocks(session(3, 'run'))
    expect(blocks.map((b) => [b.name, b.seconds, b.lane, b.rep, b.work])).toEqual([
      ['Warm-up', 600, 'easy', null, false],
      ['Rep 1 of 3', 480, 'run', 1, true],
      ['Jog', 90, 'easy', null, false],
      ['Rep 2 of 3', 480, 'run', 2, true],
      ['Jog', 90, 'easy', null, false],
      ['Rep 3 of 3', 480, 'run', 3, true],
      ['Cooldown', 480, 'easy', null, false],
    ])
    expect(blocks.reduce((sum, b) => sum + (b.seconds ?? 0), 0)).toBe(45 * 60)
  })

  it('keeps drills, plyometrics and accelerations as Blocks of their own', () => {
    const blocks = liveBlocks(drillsRun('by-feel'))
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
    expect(blocks[4]).toMatchObject({ seconds: 180, lane: 'run' })
    expect(blocks[5]).toMatchObject({ seconds: 90, kind: 'recovery' })
  })

  it('runs an Easy run as one Block, and a run to a distance to the distance, not the clock', () => {
    expect(liveBlocks(session(3, 'easy'))).toMatchObject([{ name: 'Easy run', seconds: 30 * 60, lane: 'easy', work: true }])
    const test = liveBlocks(DISTANCE_RUN)
    expect(test.map((b) => [b.name, b.kind, b.seconds, b.meters])).toEqual([
      ['Warm-up', 'warm-up', 600, null],
      ['Strides', 'drills', null, null],
      ['5 km', 'distance', null, 5000],
      ['Cooldown', 'cooldown', 480, null],
    ])
  })

  it('covers only Sessions that are all running: Threshold reps and the Easy run, not rounds with a Station', () => {
    expect(['hyrox-a', 'hyrox-b', 'run', 'strength', 'easy'].map((id) => isLiveRun(session(3, id)))).toEqual([
      false, false, true, false, true,
    ])
    expect(isLiveRun(session(6, 'run'))).toBe(false)
    expect(isLiveRun(session(2, 'compromised-run-test'))).toBe(false)
  })

  it('runs everything live but Strength: HYROX, Compromised intervals, the test and Race simulations too', () => {
    expect(['hyrox-a', 'hyrox-b', 'run', 'strength', 'easy'].map((id) => isLive(session(3, id)))).toEqual([
      true, true, true, false, true,
    ])
    expect(isLive(session(6, 'run'))).toBe(true)
    expect(isLive(session(2, 'compromised-run-test'))).toBe(true)
    expect(isLive(session(16, 'race-simulation'))).toBe(true)
  })
})

describe('liveTarget', () => {
  const [, rep, jog] = liveBlocks(THRESHOLD)

  it('reads Threshold as treadmill speed, with the pace per km and incline beside it, in either unit', () => {
    expect(liveTarget(rep, indoor)).toEqual({
      value: '12.3',
      unit: 'km/h',
      secondary: { value: '4:52', unit: '/km' },
      incline: 1,
      pace: 292,
      figure: '12.3 km/h · 4:52/km · 1% incline',
      words: '12.3 km/h · 4:52/km · 1% incline',
    })
    expect(liveTarget(rep, { ...indoor, unit: 'mph' })).toMatchObject({
      value: '7.7',
      unit: 'mph',
      secondary: { value: '4:52', unit: '/km' },
      figure: '7.7 mph · 4:52/km · 1% incline',
    })
  })

  it('reads it as pace per km alone outdoors', () => {
    expect(liveTarget(rep, { ...indoor, environment: 'outdoor' })).toMatchObject({
      value: '4:52',
      unit: '/km',
      secondary: null,
      incline: null,
      figure: '4:52/km',
      words: '4:52/km',
    })
  })

  it('takes the middle of an Easy range for the hero figure and keeps the range in words', () => {
    const [warmUp] = liveBlocks(THRESHOLD)
    const target = liveTarget({ ...warmUp, effort: { pace: 'easy' } }, indoor)!
    const [fast, slow] = paces.easy
    const middle = Math.round((fast + slow) / 2)
    expect(target.pace).toBe(middle)
    expect(target.secondary).toEqual({ value: clock(middle), unit: '/km' })
    expect(target.figure).toBe(`${target.value} km/h · ${clock(middle)}/km · 1% incline`)
    expect(target.words).toMatch(/^\d+\.\d–\d+\.\d km\/h · \d:\d\d–\d:\d\d\/km · 1% incline$/)
  })

  describe('a recovery jog', () => {
    // Race run pace 5:07: Easy 6:07–6:37/km, so its slow end is 9.1 km/h.
    const slowEasy = Math.round((3600 / paces.easy[1]) * 10) / 10

    it('suggests the slow end of Easy pace less 0.5 km/h, with walking allowed', () => {
      expect(slowEasy).toBe(9.1)
      expect(liveTarget(jog, indoor)).toEqual({
        value: '8.6',
        unit: 'km/h',
        secondary: { value: '6:59', unit: '/km' },
        incline: 1,
        pace: 419,
        figure: '8.6 km/h · 6:59/km · 1% incline',
        words: 'Jog ~8.6 km/h · 6:59/km, or walk',
      })
    })

    it('reads in the Settings unit indoors and as pace per km outdoors', () => {
      expect(liveTarget(jog, { ...indoor, unit: 'mph' })).toMatchObject({ value: '5.3', unit: 'mph', words: 'Jog ~5.3 mph · 6:59/km, or walk' })
      expect(liveTarget(jog, { ...indoor, environment: 'outdoor' })).toMatchObject({
        value: '6:59',
        unit: '/km',
        incline: null,
        words: 'Jog ~6:59/km, or walk',
      })
    })

    it('comes from Estimated Training paces the same way', () => {
      const estimated = { ...indoor, paces: trainingPaces(307, { estimate: true }) }
      expect(liveTarget(jog, estimated)).toMatchObject({ value: '8.6', words: 'Jog ~8.6 km/h · 6:59/km, or walk' })
    })

    it('is ~7 km/h with no Training paces', () => {
      const none = { ...indoor, paces: null }
      expect(liveTarget(jog, none)).toEqual({
        value: '7.0',
        unit: 'km/h',
        secondary: { value: '8:34', unit: '/km' },
        incline: 1,
        pace: 514,
        figure: '7.0 km/h · 8:34/km · 1% incline',
        words: 'Jog ~7.0 km/h · 8:34/km, or walk',
      })
      expect(liveTarget(jog, { ...none, environment: 'outdoor' })).toMatchObject({ value: '8:34', words: 'Jog ~8:34/km, or walk' })
    })

    it('has no floor: slow Easy pace gives a slow jog', () => {
      const slow = { ...indoor, paces: trainingPaces(600) }
      const kmh = Math.round((3600 / slow.paces.easy[1]) * 10) / 10 - 0.5
      expect(kmh).toBeLessThan(7)
      expect(liveTarget(jog, slow)?.value).toBe(kmh.toFixed(1))
    })

    it('never asks Held it or Changed', () => {
      // Rep 1 ends at minute 22 and asks; its jog ends at 24 and doesn't.
      const run = advance(go(start(THRESHOLD), at(10)), at(24.5))
      expect(run).toMatchObject({ block: 3, asks: [1] })
    })
  })

  it('is the RPE with no Training paces, and nothing for drills or a run by feel alone', () => {
    expect(liveTarget(rep, { ...indoor, paces: null })).toEqual({
      value: '6–7',
      unit: 'RPE',
      secondary: null,
      incline: 1,
      pace: null,
      figure: 'RPE 6–7',
      words: 'RPE 6–7',
    })
    const speed = liveBlocks(drillsRun('by-feel'))
    expect(liveTarget(speed[1], indoor)).toBeNull()
    expect(liveTarget(speed[3], indoor)).toBeNull()
  })
})

describe('the Live run clock', () => {
  it('walks through the Blocks as time passes, asking after each rep', () => {
    let run = start(THRESHOLD)
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
    const run = advance(go(start(THRESHOLD), at(10)), at(40))
    expect(run).toMatchObject({ block: 4, asks: [1, 3] })
    expect(blockLeft(run, at(40))).toBe(5 * 60)

    const over = advance(run, at(60))
    expect(over.block).toBe(5)
    expect(over.finishedAt).toBe(at(45))
    expect(isOver(over)).toBe(true)
  })

  it('stops while paused and picks up where it left off', () => {
    let run = pause(start(THRESHOLD), at(5))
    expect(blockLeft(run, at(30))).toBe(300)
    expect(advance(run, at(30))).toBe(run)

    run = resume(run, at(30))
    expect(blockLeft(run, at(30))).toBe(300)
    run = go(run, at(35))
    expect(run.block).toBe(1)
    expect(blockLeft(run, at(36))).toBe(660)
  })

  it('skips a work Block at once, paused or not, and remembers it was cut short', () => {
    let run = go(start(THRESHOLD), at(10))
    run = nextBlock(run, at(12))
    expect(run).toMatchObject({ block: 2, skipped: [1], asks: [1], cutShort: [{ block: 1, seconds: 120 }] })
    expect(blockLeft(run, at(13))).toBe(60)

    run = nextBlock(pause(go(run, at(14)), at(14)), at(15))
    expect(run).toMatchObject({ block: 4, skipped: [1, 3], pausedAt: at(14) })
  })

  it('ends a Block that isn’t work with Done: not skipped, so the log stays Done', () => {
    let run = nextBlock(start(THRESHOLD), at(6))
    expect(run).toMatchObject({ block: 1, skipped: [], cutShort: [{ block: 0, seconds: 360 }] })
    run = advance(go(run, at(6)), at(60))
    expect(liveStatus(run)).toBe('done')
  })

  it('times a run to a distance from its start to the tap that says it’s covered', () => {
    let run = onDistance(start(DISTANCE_RUN))
    expect(run.block).toBe(2)
    expect(blockLeft(run, at(30))).toBeNull()
    expect(advance(run, at(60))).toBe(run)

    run = nextBlock(run, at(34.5))
    expect(run).toMatchObject({ block: 3, splits: [{ block: 2, seconds: 22 * 60 + 30 }], skipped: [] })
  })

  it('ends on the finish sheet, and Keep going goes back to the clock', () => {
    const run = end(advance(go(start(THRESHOLD), at(10)), at(15)), at(15))
    expect(run).toMatchObject({ ending: true, pausedAt: at(15), block: 1 })
    expect(isOver(run)).toBe(true)

    const back = resume(run, at(16))
    expect(isOver(back)).toBe(false)
    expect(blockLeft(back, at(16))).toBe(720 - 300)
  })

  it('records Held it and Changed once per rep', () => {
    let run = advance(go(start(THRESHOLD), at(10)), at(40))
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
    let quiet = advance(go(start(THRESHOLD), at(10)), at(45))
    quiet = heldUnanswered(answer(quiet, 3, 292, 298), indoor)
    expect(quiet.asks).toEqual([])
    expect(quiet.intervals.map((i) => [i.block, i.held])).toEqual([
      [1, true],
      [3, false],
    ])

    let cut = advance(go(start(THRESHOLD), at(10)), at(15))
    cut = heldUnanswered(nextBlock(cut, at(15)), indoor)
    expect(cut.intervals).toEqual([])
  })
})

describe('checklist Blocks', () => {
  const speed = () => start(drillsRun('by-feel'))
  /** On Plyometrics at minute 10: the jog ran its 7, the Drills were Done at 10. */
  const plyometrics = () => nextBlock(advance(speed(), at(7)), at(10))

  it('lays Plyometrics and Accelerations out as a set to tick at a time, on a clock that counts up', () => {
    const [warmUp, , plyo, accels] = liveBlocks(drillsRun('by-feel'))
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
    expect(plyo(drillsRun('deload'))).toEqual(['Pogo jumps 15', 'Broad jumps 2 · set 1 of 2', 'Broad jumps 2 · set 2 of 2'])
    expect(plyo(drillsRun('taper'))).toEqual(['Pogo jumps 10'])
    expect(plyo(equip(drillsRun('by-feel'), []))).toEqual(['Sled push sprints 10–15 m', 'Sled push sprints 10–15 m'])
    const bike = { ...drillsRun('by-feel'), blocks: drillsRun('by-feel').blocks.map((b) => ({ ...b, exercises: b.exercises.map((e) => (e.name === 'Pogo jumps' ? e.substitutions![0].options[1] : e)) })) }
    expect(plyo(bike)).toEqual(['Bike sprints 8–10″', 'Broad jumps 3 · set 1 of 3', 'Broad jumps 3 · set 2 of 3', 'Broad jumps 3 · set 3 of 3'])
  })

  it('leaves Drills and Accelerations rows as they were', () => {
    const [, drills, , accels] = liveBlocks(drillsRun('by-feel'))
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

describe('rest on checklist Blocks', () => {
  const plyometrics = (week: 3 | 7 = 3) => nextBlock(advance(start(drillsRun(week === 3 ? 'by-feel' : 'deload')), at(7)), at(10))
  /** On Accelerations at minute 14: Plyometrics Done at 13. */
  const accelerations = () => nextBlock(plyometrics(), at(13))
  const SECOND = 1000

  it('starts the Exercise’s rest on a tick: pogo 60″, broad jumps 20″, Accelerations 45″', () => {
    const pogo = tick(plyometrics(), 0, at(11))
    expect(pogo.rest).toEqual({ row: 0, startedAt: at(11), seconds: 60 })
    expect(restLeft(pogo, at(11) + 15 * SECOND)).toBe(45)
    expect(restLeft(pogo, at(13))).toBe(0)
    const broad = tick(tick(pogo, 1, at(12)), 2, at(12.5))
    expect(broad.rest).toEqual({ row: 2, startedAt: at(12.5), seconds: 20 })
    const accels = tick(accelerations(), 0, at(14))
    expect(accels.rest).toEqual({ row: 0, startedAt: at(14), seconds: 45 })
  })

  it('ends the rest on the next tick, which starts its own; the Block’s last set starts none', () => {
    let run = tick(plyometrics(), 0, at(11))
    run = tick(run, 1, at(11.25))
    expect(run.rest).toEqual({ row: 1, startedAt: at(11.25), seconds: 60 })
    run = tick(tick(tick(run, 2, at(12)), 3, at(12.5)), 4, at(13))
    expect(run.block).toBe(3)
    expect(run.rest).toBeNull()
    expect(restLeft(run, at(13))).toBeNull()
    // Ticked out of order, the last one left still ends the Block with no rest.
    const accels = [3, 2, 1].reduce((r, row) => tick(r, row, at(14)), accelerations())
    expect(accels.rest).not.toBeNull()
    expect(tick(accels, 0, at(14.5)).rest).toBeNull()
  })

  it('clears the rest on an untick, Done, End or the rest’s own end', () => {
    const resting = tick(plyometrics(), 0, at(11))
    expect(tick(resting, 0, at(11.1)).rest).toBeNull()
    expect(nextBlock(resting, at(11.1)).rest).toBeNull()
    expect(end(resting, at(11.1)).rest).toBeNull()
    expect(endRest(resting).rest).toBeNull()
    expect(endRest(plyometrics())).toEqual(plyometrics())
  })

  it('clears it on Skip block too, and going back', () => {
    const resting = tick(plyometrics(), 0, at(11))
    expect(goBack(resting, 1, at(11.1)).rest).toBeNull()
    const skipped = { ...resting, blocks: resting.blocks.map((b, i) => (i === 2 ? { ...b, work: true } : b)) }
    expect(nextBlock(skipped, at(11.1))).toMatchObject({ rest: null, skipped: [2] })
  })

  it('gives the Drills no rest', () => {
    const drills = advance(start(drillsRun('by-feel')), at(7))
    expect(drills.blocks[1].kind).toBe('drills')
    expect(tick(drills, 1, at(8)).rest).toBeNull()
  })

  it('rests the Deload’s and the Taper’s jumps the same way', () => {
    const deload = tick(plyometrics(7), 0, at(11))
    expect(deload.rest).toEqual({ row: 0, startedAt: at(11), seconds: 60 })
    expect(tick(deload, 1, at(12)).rest).toEqual({ row: 1, startedAt: at(12), seconds: 20 })
    // The Taper's one pogo set is the whole Block: ticking it ends the Block, with nothing to rest before.
    const taper = nextBlock(advance(start(drillsRun('taper')), at(7)), at(10))
    expect(taper.blocks[taper.block].checklist).toEqual(['Pogo jumps 10'])
    expect(tick(taper, 0, at(11))).toMatchObject({ block: 3, rest: null })
  })

  it('parses a run stored before rests with none', () => {
    const { rest: _r, ...old } = plyometrics()
    const blocks = old.blocks.map(({ rests: _, ...b }) => b)
    const parsed = parseLiveRun(JSON.parse(JSON.stringify({ ...old, blocks })))!
    expect(parsed.rest).toBeNull()
    expect(tick(parsed, 0, at(11)).rest).toBeNull()
  })
})

describe('the Ready screen', () => {
  it('holds the first rep after the warm-up until Start, and the wait isn’t active time', () => {
    let run = advance(start(THRESHOLD), at(12))
    expect(run).toMatchObject({ block: 1, ready: true, pausedAt: at(10) })
    expect(blockLeft(run, at(13))).toBe(720)
    expect(advance(run, at(30))).toBe(run)

    run = resume(run, at(13))
    expect(run).toMatchObject({ ready: false, pausedAt: null })
    expect(blockLeft(run, at(14))).toBe(660)
    run = advance(run, at(60))
    expect(liveLog(run, at(60), { id: 'x', rpe: 7, distanceMeters: null, updatedAt: '' }).minutes).toBe(45)
  })

  it('shows after Done or Skip block too, and stays on Ready through End and Keep going', () => {
    let run = nextBlock(start(THRESHOLD), at(4))
    expect(run).toMatchObject({ block: 1, ready: true, pausedAt: at(4) })
    run = resume(end(run, at(5)), at(6))
    expect(run).toMatchObject({ ending: false, ready: true, pausedAt: at(4) })
  })

  it('never holds between reps and recoveries', () => {
    const run = advance(go(start(drillsRun('by-feel')), at(10)), at(10))
    // Warm-up, then the checklist Blocks tapped through: Rep 1 holds, then the set flows.
    let r = go(nextBlock(nextBlock(nextBlock(run, at(10)), at(12)), at(14)), at(14))
    expect(r.block).toBe(4)
    r = advance(r, at(14 + 3 + 1.5 + 1))
    expect(r).toMatchObject({ block: 6, ready: false, pausedAt: null })
  })

  it('holds before each HYROX round, and only before the first run of a Race simulation', () => {
    let hyrox = startRun({ week: 1, session: session(1, 'hyrox-a'), date: localDate('2026-11-11'), environment: 'indoor' }, T0)
    hyrox = nextBlock(advance(hyrox, at(5)), at(7))
    expect(hyrox).toMatchObject({ block: 2, ready: true })
    hyrox = nextBlock(nextBlock(resume(hyrox, at(8)), at(11)), at(14))
    expect(hyrox).toMatchObject({ block: 3, ready: true, pausedAt: at(14) })

    let sim = startRun({ week: 16, session: session(16, 'race-simulation'), date: localDate('2027-02-24'), environment: 'indoor' }, T0)
    sim = advance(sim, at(10))
    expect(sim).toMatchObject({ block: 1, ready: true })
    sim = nextBlock(resume(sim, at(10)), at(14))
    expect(sim).toMatchObject({ block: 2, ready: false, pausedAt: null })
  })
})

describe('Undo', () => {
  it('restores the Block skipped, its clock still running from where it was', () => {
    const before = go(start(THRESHOLD), at(10))
    const skipped = nextBlock(before, at(12))
    expect(canUndo(skipped, at(12.1))).toBe(true)
    const back = undo(skipped, at(12.1))
    expect(back).toMatchObject({ block: 1, skipped: [], asks: [], cutShort: [], undo: null })
    // The seconds since the tap count toward Rep 1.
    expect(blockElapsed(back, at(12.1))).toBe(126)
  })

  it('restores a Block ended with Done, from the Ready screen or after Start', () => {
    const done = nextBlock(start(THRESHOLD), at(5))
    const started = resume(done, at(5.05))
    for (const run of [done, started]) {
      const back = undo(run, at(5.1))
      expect(back).toMatchObject({ block: 0, ready: false, pausedAt: null })
      expect(blockElapsed(back, at(5.1))).toBe(306)
    }
  })

  it('lasts about 8 seconds, and goes once something else is recorded', () => {
    const skipped = nextBlock(go(start(THRESHOLD), at(10)), at(12))
    expect(canUndo(skipped, at(12) + 7_900)).toBe(true)
    expect(canUndo(skipped, at(12) + 8_100)).toBe(false)
    expect(undo(skipped, at(12) + 8_100)).toBe(skipped)
    expect(canUndo(answer(skipped, 1, 292, null), at(12))).toBe(false)
  })
})

describe('going back to an earlier Block', () => {
  /** Threshold on Rep 2, 30 s in: Rep 1 skipped at 11 of 12 minutes. */
  const onRep2 = () => {
    let run = go(start(THRESHOLD), at(10))
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
    expect(liveLog(back, at(24), { id: 'x', rpe: 7, distanceMeters: null, updatedAt: '' }).minutes).toBe(24)
  })

  it('restarts a timed Block that ran its time, and keeps what earlier Blocks recorded', () => {
    let run = advance(go(start(THRESHOLD), at(10)), at(36))
    run = answer(run, 1, 292, null)
    expect(run.block).toBe(4)
    expect(redone(run, 2)).toEqual([3])
    const back = goBack(run, 2, at(36))
    expect(back).toMatchObject({ block: 2, intervals: [{ block: 1 }], asks: [] })
    expect(blockElapsed(back, at(36))).toBe(0)
    expect(redone(run, 0)).toEqual([1, 3])
  })

  it('picks a Block run to a distance up from its split', () => {
    const run = nextBlock(onDistance(start(DISTANCE_RUN)), at(34.5))
    const back = goBack(run, 2, at(35))
    expect(back).toMatchObject({ block: 2, splits: [] })
    expect(blockElapsed(back, at(35))).toBe(22 * 60 + 30)
  })

  it('needs nothing confirmed when nothing recorded would be lost', () => {
    const run = advance(start(THRESHOLD), at(10))
    expect(redone(run, 0)).toEqual([])
    expect(goBack(run, 0, at(11))).toMatchObject({ block: 0, pausedAt: null })
    expect(goBack(run, 1, at(11))).toBe(run)
  })
})

describe('the finish sheet', () => {
  it('lists the work cut short, and one tap flips the log to Done', () => {
    let run = go(start(THRESHOLD), at(10))
    run = nextBlock(run, at(21.5))
    run = end(advance(run, at(36)), at(36))
    expect(liveStatus(run)).toBe('partial')
    expect(shortBlocks(run)).toEqual([{ block: 1, seconds: 690 }])
    const flipped = markDone(run, true)
    expect(liveStatus(flipped)).toBe('done')
    expect(liveStatus(markDone(flipped, false))).toBe('partial')
  })

  it('lists the work never reached, and the time run on the Block it ended in', () => {
    const run = end(advance(go(start(THRESHOLD), at(10)), at(15)), at(15))
    expect(shortBlocks(run)).toEqual([
      { block: 1, seconds: 300 },
      { block: 3, seconds: null },
    ])
  })

  it('takes Done tapped on the last Block back, onto the cooldown where it was left', () => {
    let run = advance(go(start(THRESHOLD), at(10)), at(40))
    run = answer(answer(run, 1, 292, null), 3, 292, null)
    run = nextBlock(run, at(44))
    expect(isOver(run)).toBe(true)
    expect(canKeepGoing(run)).toBe(true)
    const back = keepGoing(run, at(45))
    expect(isOver(back)).toBe(false)
    expect(back).toMatchObject({ block: 4, finishedAt: null, cutShort: [], intervals: [{ block: 1 }, { block: 3 }] })
    expect(blockElapsed(back, at(45))).toBe(8 * 60)
  })

  it('keeps a run to a distance when its cooldown is taken back, and goes back to the clock after End', () => {
    const run = nextBlock(nextBlock(onDistance(start(DISTANCE_RUN)), at(34.5)), at(35))
    expect(canKeepGoing(run)).toBe(true)
    const back = keepGoing(run, at(36))
    expect(back).toMatchObject({ block: 3, splits: [{ block: 2, seconds: 22 * 60 + 30 }] })
    expect(blockElapsed(back, at(36))).toBe(30)

    const ended = end(advance(go(start(THRESHOLD), at(10)), at(15)), at(15))
    expect(canKeepGoing(ended)).toBe(true)
    expect(keepGoing(ended, at(16))).toEqual(resume(ended, at(16)))
  })

  it('offers nothing to go back to when the clock ran the last Block out', () => {
    const run = advance(go(start(THRESHOLD), at(10)), at(60))
    expect(isOver(run)).toBe(true)
    expect(canKeepGoing(run)).toBe(false)
    expect(keepGoing(run, at(61))).toBe(run)
  })
})

describe('liveLog', () => {
  const input = { id: 'live-1234', rpe: 7, distanceMeters: 9400, updatedAt: '2026-11-11T18:00:00.000Z' }

  it('logs a Session run to the end as Done, with its time, Environment, distance and reps', () => {
    let run = pause(advance(start(THRESHOLD), at(5)), at(5))
    run = advance(go(resume(run, at(7)), at(12)), at(60))
    run = answer(run, 1, 292, null)
    expect(liveLog(run, at(60), input)).toEqual({
      id: 'live-1234',
      week: 3,
      sessionId: 'run',
      date: '2026-11-11',
      status: 'done',
      minutes: 45,
      rpe: 7,
      notes: null,
      resultSeconds: null,
      environment: 'indoor',
      distanceMeters: 9400,
      recoveryPace: null,
      intervals: [{ block: 1, rep: 1, targetPace: 292, held: true, actualPace: null }],
      sets: [],
      stations: [],
      updatedAt: '2026-11-11T18:00:00.000Z',
    })
  })

  it('is Partial when a rep was skipped or the Session ended before the reps were done', () => {
    const skipped = advance(go(nextBlock(go(start(THRESHOLD), at(10)), at(11)), at(11)), at(60))
    expect(liveLog(skipped, at(60), input).status).toBe('partial')
    const ended = end(advance(go(start(THRESHOLD), at(10)), at(20)), at(20))
    expect(liveLog(ended, at(25), input)).toMatchObject({ status: 'partial', minutes: 20 })
    const inCooldown = end(advance(go(start(THRESHOLD), at(10)), at(40)), at(40))
    expect(liveLog(inCooldown, at(40), input).status).toBe('done')
  })

  it('keeps the console distance only indoors, and no result time', () => {
    const covered = nextBlock(onDistance(start(DISTANCE_RUN, 'outdoor')), at(34.5))
    expect(liveLog(end(covered, at(36)), at(36), input)).toMatchObject({
      sessionId: 'distance-run',
      status: 'done',
      resultSeconds: null,
      environment: 'outdoor',
      distanceMeters: null,
    })
    const indoorRun = nextBlock(onDistance(start(DISTANCE_RUN)), at(34.5))
    expect(liveLog(end(indoorRun, at(36)), at(36), input)).toMatchObject({ distanceMeters: 9400, resultSeconds: null })
  })
})

describe('by-feel speeds', () => {
  const input = { id: 'live-5678', rpe: 8, distanceMeters: null, updatedAt: '2026-11-11T18:00:00.000Z' }
  /** 14 km/h and 6 km/h, as seconds per km. */
  const HARD = 257
  const JOG = 600
  /**
   * Speed on Rep 1 at minute 10: the jog ran its 7, drills, Plyometrics and
   * Accelerations Done at 8, 9 and 10, Start at once. Reps are Blocks 4, 6, 8, 10 and 12.
   */
  const onRep1 = (kind: 'by-feel' | 'paced') => go(nextBlock(nextBlock(nextBlock(advance(start(drillsRun(kind)), at(7)), at(8)), at(9)), at(10)), at(10))

  it('raises no Held it or Changed after a by-feel rep, and still does after a paced one', () => {
    const byFeel = advance(onRep1('by-feel'), at(40))
    expect(byFeel.blocks[4]).toMatchObject({ name: 'Rep 1 of 5', effort: { feel: 'hard' } })
    expect(isOver(byFeel)).toBe(true)
    expect(byFeel.asks).toEqual([])
    expect(answer(byFeel, 4, null, HARD)).toBe(byFeel)

    const paced = advance(onRep1('paced'), at(40))
    expect(paced.asks).toEqual([4, 6, 8, 10, 12])
  })

  it('asks the question at the end only of a run with by-feel reps', () => {
    expect(hasByFeelReps(start(drillsRun('by-feel')))).toBe(true)
    expect(hasByFeelReps(start(drillsRun('paced')))).toBe(false)
    expect(hasByFeelReps(start(THRESHOLD))).toBe(false)
    // Deload reps are controlled: Threshold pace, so asked per rep like any paced rep.
    expect(hasByFeelReps(start(drillsRun('deload')))).toBe(false)
  })

  it('logs the hard-rep speed on every by-feel rep not cut short, and the jogs’ as the recovery pace', () => {
    // Rep 2 skipped a minute in.
    const run = advance(nextBlock(advance(onRep1('by-feel'), at(15.5)), at(15.5)), at(40))
    const log = liveLog(heldUnanswered(run, indoor), at(40), { ...input, hardPace: HARD, recoveryPace: JOG })
    expect(log).toMatchObject({ status: 'partial', recoveryPace: JOG })
    expect(log.intervals).toEqual(
      [4, 8, 10, 12].map((block) => ({ block, rep: block / 2 - 1, targetPace: null, held: false, actualPace: HARD })),
    )
  })

  it('leaves out the reps never reached or ended in', () => {
    const ended = end(advance(onRep1('by-feel'), at(16)), at(16))
    expect(liveLog(ended, at(16), { ...input, hardPace: HARD }).intervals.map((i) => i.block)).toEqual([4])
  })

  it('saves the log without them when the question is skipped', () => {
    const run = advance(onRep1('by-feel'), at(40))
    const log = liveLog(heldUnanswered(run, indoor), at(40), input)
    expect(log.recoveryPace).toBeNull()
    expect(log.intervals).toEqual(
      [4, 6, 8, 10, 12].map((block) => ({ block, rep: block / 2 - 1, targetPace: null, held: true, actualPace: null })),
    )
    expect(liveLog(run, at(40), { ...input, hardPace: null, recoveryPace: null })).toEqual(log)
  })

  it('keeps paced reps’ own answers, and gives them no recovery pace but the jogs’', () => {
    let run = advance(onRep1('paced'), at(40))
    run = heldUnanswered(answer(run, 6, 270, 280), indoor)
    const log = liveLog(run, at(40), { ...input, hardPace: HARD, recoveryPace: JOG })
    expect(log.intervals.map((i) => [i.block, i.held, i.actualPace])).toEqual([
      [4, true, null],
      [6, false, 280],
      [8, true, null],
      [10, true, null],
      [12, true, null],
    ])
  })

  it('logs a run stored before by-feel speeds, its by-feel reps already asked, once per rep', () => {
    const run = advance(onRep1('by-feel'), at(40))
    const stored = parseLiveRun(JSON.parse(JSON.stringify({ ...run, asks: [4, 6, 8, 10, 12] })))!
    expect(stored.asks).toEqual([4, 6, 8, 10, 12])
    const log = liveLog(heldUnanswered(stored, indoor), at(40), { ...input, hardPace: HARD })
    expect(log.intervals.map((i) => [i.block, i.held, i.actualPace])).toEqual(
      [4, 6, 8, 10, 12].map((block) => [block, false, HARD]),
    )
  })

})

describe('last time', () => {
  const input = { id: 'live-9012', rpe: 8, distanceMeters: null, updatedAt: '2026-11-11T18:00:00.000Z' }
  /** 14 km/h and 6 km/h, as seconds per km. */
  const HARD = 257
  const JOG = 600
  /** Week 3's Speed from Rep 1 to the end, the By-feel speeds answered, logged on `date`. */
  const run = advance(go(nextBlock(nextBlock(nextBlock(advance(start(drillsRun('by-feel')), at(7)), at(8)), at(9)), at(10)), at(10)), at(60))
  const speedLog = (date: string, hardPace: number | null, recoveryPace: number | null): SessionLog => ({
    ...liveLog(run, at(60), { ...input, hardPace, recoveryPace }),
    id: `live-${date}`,
    date: localDate(date),
  })
  const today = localDate('2026-11-18')
  const byFeel = liveBlocks(drillsRun('by-feel'))[4]

  // A hard-rep speed is read back only from a Program Session that runs its reps
  // by feel, and the Program has none now: only the jogs' pace comes back.
  it('is the latest jog pace logged before the Session, of any Session type', () => {
    const logs = [speedLog('2026-11-04', 240, 620), speedLog('2026-11-11', HARD, JOG), speedLog('2026-11-25', 200, 400)]
    expect(loggedSpeeds(logs, today)).toEqual({ hardPace: null, recoveryPace: JOG })
    // The same day's own log doesn't count: it's this Session's.
    expect(loggedSpeeds(logs, localDate('2026-11-11'))).toEqual({ hardPace: null, recoveryPace: 620 })
  })

  it('takes it from the latest log that has it', () => {
    const logs = [speedLog('2026-11-04', 240, 620), speedLog('2026-11-11', HARD, null), speedLog('2026-11-12', null, null)]
    expect(loggedSpeeds(logs, today)).toEqual({ hardPace: null, recoveryPace: 620 })
  })

  it('is nothing with no history', () => {
    expect(loggedSpeeds([], today)).toEqual({ hardPace: null, recoveryPace: null })
    expect(loggedSpeeds([speedLog('2026-11-11', null, null)], today)).toEqual({ hardPace: null, recoveryPace: null })
  })

  it('never reads a paced rep run by RPE and changed', () => {
    let run = advance(go(start(THRESHOLD), at(10)), at(60))
    run = answer(run, 1, null, 270)
    const changed = { ...liveLog(run, at(60), input), date: localDate('2026-11-12') }
    expect(changed.intervals).toEqual([{ block: 1, rep: 1, targetPace: null, held: false, actualPace: 270 }])
    expect(loggedSpeeds([changed], today).hardPace).toBeNull()
  })

  describe('beside a by-feel rep', () => {
    const logged = { hardPace: HARD, recoveryPace: JOG }

    it('reads as a speed in the Settings unit indoors, and as a pace per km outdoors', () => {
      expect(byFeelHint(byFeel, { ...indoor, logged })).toBe('Last time 14.0 km/h')
      expect(byFeelHint(byFeel, { ...indoor, unit: 'mph', logged })).toBe('Last time 8.7 mph')
      // Logged on the treadmill, run outside: the same pace, per km.
      expect(byFeelHint(byFeel, { ...indoor, environment: 'outdoor', logged })).toBe('Last time 4:17/km')
    })

    it('shows nothing with no history, or on any other Block', () => {
      expect(byFeelHint(byFeel, indoor)).toBeNull()
      expect(byFeelHint(byFeel, { ...indoor, logged: { hardPace: null, recoveryPace: JOG } })).toBeNull()
      const [, rep, jog] = liveBlocks(THRESHOLD)
      expect(byFeelHint(rep, { ...indoor, logged })).toBeNull()
      expect(byFeelHint(jog, { ...indoor, logged })).toBeNull()
    })

    it('is never a target, and raises no check', () => {
      expect(liveTarget(byFeel, { ...indoor, logged })).toBeNull()
      expect(isOver(run)).toBe(true)
      expect(run.asks).toEqual([])
      expect(heldUnanswered(run, { ...indoor, logged })).toEqual(heldUnanswered(run, indoor))
    })

  })

  describe('the recovery jog', () => {
    const [, , jog] = liveBlocks(THRESHOLD)

    it('is the latest logged jog pace with no Training paces', () => {
      const none = { ...indoor, paces: null, logged: { hardPace: null, recoveryPace: JOG } }
      expect(liveTarget(jog, none)).toMatchObject({ value: '6.0', pace: JOG, words: 'Jog ~6.0 km/h · 10:00/km, or walk' })
      const outside = { ...none, environment: 'outdoor' as const, logged: { hardPace: null, recoveryPace: 357 } }
      expect(liveTarget(jog, outside)).toMatchObject({ value: '5:57', pace: 357, words: 'Jog ~5:57/km, or walk' })
    })

    it('still comes from the Training paces first, real or estimated', () => {
      const logged = { hardPace: null, recoveryPace: JOG }
      expect(liveTarget(jog, { ...indoor, logged })).toMatchObject({ value: '8.6', pace: 419 })
      const estimated = { ...indoor, paces: trainingPaces(307, { estimate: true }), logged }
      expect(liveTarget(jog, estimated)).toMatchObject({ value: '8.6', pace: 419 })
    })
  })

  describe('the end-of-run question', () => {
    const logged = { hardPace: HARD, recoveryPace: JOG }

    it('pre-fills both fields from the latest logged values, as typed', () => {
      expect(byFeelPrefill(start(drillsRun('by-feel')), { ...indoor, logged })).toEqual({ hard: '14.0', jog: '6.0' })
      expect(byFeelPrefill(start(drillsRun('by-feel')), { ...indoor, unit: 'mph', logged })).toEqual({ hard: '8.7', jog: '3.7' })
      expect(byFeelPrefill(start(drillsRun('by-feel'), 'outdoor'), { ...indoor, environment: 'outdoor', logged })).toEqual({
        hard: '4:17',
        jog: '10:00',
      })
    })

    it('leaves blank what was never logged', () => {
      expect(byFeelPrefill(start(drillsRun('by-feel')), indoor)).toEqual({ hard: '', jog: '' })
      expect(byFeelPrefill(start(drillsRun('by-feel')), { ...indoor, logged: { hardPace: HARD, recoveryPace: null } })).toEqual({
        hard: '14.0',
        jog: '',
      })
    })
  })
})

describe('parseLiveRun', () => {
  it('takes back what was stored, and drops anything it can’t trust', () => {
    const run = advance(start(THRESHOLD), at(12))
    expect(parseLiveRun(JSON.parse(JSON.stringify(run)))).toEqual(run)
    expect(parseLiveRun(null)).toBeNull()
    expect(parseLiveRun({ ...run, blocks: [] })).toBeNull()
    expect(parseLiveRun({ ...run, type: 'strength' })).toBeNull()
    expect(parseLiveRun({ ...run, startedAt: 'yesterday' })).toBeNull()
  })

  it('keeps an Undo, and takes back a run stored before Done, Ready and Undo', () => {
    const skipped = nextBlock(go(start(THRESHOLD), at(10)), at(12))
    expect(parseLiveRun(JSON.parse(JSON.stringify(skipped)))).toEqual(skipped)

    const { ready: _r, cutShort: _c, ticked: _t, undo: _u, markedDone: _m, ...old } = advance(start(THRESHOLD), at(5))
    const blocks = old.blocks.map(({ checklist: _, ...b }) => b)
    const parsed = parseLiveRun(JSON.parse(JSON.stringify({ ...old, blocks })))!
    expect(parsed).toMatchObject({ block: 0, ready: false, cutShort: [], ticked: [], undo: null, markedDone: false })
    expect(parsed.blocks[0].checklist).toEqual([])
  })
})

describe('HYROX', () => {
  const hyroxRun = (week: number, id = 'hyrox-a', date = '2026-11-11') =>
    startRun({ week, session: session(week, id), date: localDate(date), environment: 'indoor' }, T0)
  const rounds = (week: number, id: string) => liveBlocks(session(week, id)).filter((b) => b.kind === 'round')
  /** Each round as its Station, then its run: "sled-push 25 m → 400 m". */
  const layout = (week: number, id: string) =>
    rounds(week, id).map(
      (b) => `${b.stations.map((s) => `${s.station} ${s.meters ? `${s.meters} m` : `${s.reps} reps`}`).join(', ')} → ${b.meters} m`,
    )
  /** The pounds each Station of the Session is loaded with. */
  const loads = (blocks: LiveBlock[]) =>
    Object.fromEntries(blocks.flatMap((b) => b.stations).map((s) => [s.station, s.pounds]))

  it('runs warm-up, Set up, four rounds on a clock that counts up, and the cooldown', () => {
    expect(liveBlocks(session(1, 'hyrox-a')).map((b) => [b.name, b.kind, b.seconds, b.round, b.work])).toEqual([
      ['Warm-up', 'warm-up', 300, null, false],
      ['Set up', 'setup', null, null, false],
      ['Round 1 of 4', 'round', null, 1, true],
      ['Round 2 of 4', 'round', null, 2, true],
      ['Round 3 of 4', 'round', null, 3, true],
      ['Round 4 of 4', 'round', null, 4, true],
      ['Cooldown', 'cooldown', 240, null, false],
    ])
  })

  it('takes the Station volume and the run after it from the Week’s Phase', () => {
    expect(layout(1, 'hyrox-a')).toEqual([
      'sled-push 25 m → 400 m',
      'sled-pull 25 m → 400 m',
      'farmers-carry 100 m → 400 m',
      'sandbag-lunges 25 m → 400 m',
    ])
    expect(layout(1, 'hyrox-b')).toEqual(['skierg 250 m → 400 m', 'burpee-broad-jumps 20 m → 400 m', 'row 250 m → 400 m', 'wall-balls 25 reps → 400 m'])
    expect(layout(6, 'hyrox-a')).toEqual([
      'sled-push 25 m → 600 m',
      'sled-pull 25 m → 600 m',
      'farmers-carry 100 m → 600 m',
      'sandbag-lunges 50 m → 600 m',
    ])
    expect(layout(11, 'hyrox-b')).toEqual(['skierg 750 m → 800 m', 'burpee-broad-jumps 60 m → 800 m', 'row 750 m → 800 m', 'wall-balls 75 reps → 800 m'])
    expect(layout(17, 'hyrox-a')).toEqual([
      'sled-push 50 m → 1000 m',
      'sled-pull 50 m → 1000 m',
      'farmers-carry 200 m → 1000 m',
      'sandbag-lunges 100 m → 1000 m',
    ])
  })

  it('cuts a Deload week to three rounds', () => {
    expect(layout(5, 'hyrox-a')).toEqual(['sled-push 25 m → 400 m', 'sled-pull 25 m → 400 m', 'sandbag-lunges 25 m → 400 m'])
  })

  it('puts each Station before its run, so every run is a Compromised run', () => {
    for (const block of rounds(1, 'hyrox-a')) {
      expect(block.runFirst).toBe(false)
      expect(roundLegs(block)).toEqual([block.stations[0].station, 'run'])
    }
  })

  it.each([1, 6, 17])('loads every Station at Race load in Week %i: plates on the sleds, per hand on the carry, to the nearest 5 lb', (week) => {
    expect(loads(rounds(week, 'hyrox-a'))).toEqual({ 'sled-push': 335, 'sled-pull': 225, 'farmers-carry': 55, 'sandbag-lunges': 45 })
  })

  it('never scales the wall ball, and gives Stations without a load no pounds', () => {
    expect(loads(rounds(1, 'hyrox-b'))).toEqual({ skierg: null, 'burpee-broad-jumps': null, row: null, 'wall-balls': 13 })
  })

  it('times each leg of a round from a tap at its end: the Station, then the run', () => {
    let run = onRound1(hyroxRun(1))
    expect(run.blocks[run.block].name).toBe('Round 1 of 4')
    expect(roundLegs(run.blocks[run.block])).toEqual(['sled-push', 'run'])
    expect(blockLeft(run, at(9))).toBeNull()
    expect(currentLeg(run)).toBe(0)

    // The sled push in 3:00: the round goes on, onto the run, its clock from zero.
    run = nextBlock(run, at(10))
    expect(run).toMatchObject({ block: 2, legs: [{ block: 2, seconds: 180 }], asks: [] })
    expect(currentLeg(run)).toBe(1)
    expect(legElapsed(run, at(11))).toBe(60)
    expect(blockElapsed(run, at(11))).toBe(240)
    // A second tap a moment later is the same thumb bouncing: nothing happens.
    expect(nextBlock(run, at(10) + 1500)).toBe(run)

    run = tap(run, at(13))
    expect(run.legs).toEqual([{ block: 2, seconds: 180 }, { block: 2, seconds: 180 }])
    expect(run.splits).toEqual([{ block: 2, seconds: 360 }])
    expect(run.asks).toEqual([2])
    // Round 1 was heavy: the sled push went down to 315 lb and the run was 300 m.
    const [push] = run.blocks[2].stations
    run = answerStations(run, 2, { runMeters: 300, stations: [{ ...push, pounds: 315 }] })
    expect(run.asks).toEqual([])
    // Set up keeps the load it was set up with.
    expect(run.blocks[1].stations[0].pounds).toBe(335)

    run = legs(run, 15, 17)
    // Rounds 2 to 4 are never answered: they log as written.
    run = legs(run, 19.5, 21.5)
    run = legs(run, 25, 27)
    run = advance(run, at(31))
    expect(isOver(run)).toBe(true)

    expect(stationLogs(run)).toEqual([
      { round: 1, part: 'round', pounds: null, meters: null, reps: null, seconds: 360 },
      { round: 1, part: 'sled-push', pounds: 315, meters: 25, reps: null, seconds: 180 },
      { round: 1, part: 'run', pounds: null, meters: 300, reps: null, seconds: 180 },
      { round: 2, part: 'round', pounds: null, meters: null, reps: null, seconds: 240 },
      { round: 2, part: 'sled-pull', pounds: 225, meters: 25, reps: null, seconds: 120 },
      { round: 2, part: 'run', pounds: null, meters: 400, reps: null, seconds: 120 },
      { round: 3, part: 'round', pounds: null, meters: null, reps: null, seconds: 270 },
      { round: 3, part: 'farmers-carry', pounds: 55, meters: 100, reps: null, seconds: 150 },
      { round: 3, part: 'run', pounds: null, meters: 400, reps: null, seconds: 120 },
      { round: 4, part: 'round', pounds: null, meters: null, reps: null, seconds: 330 },
      { round: 4, part: 'sandbag-lunges', pounds: 45, meters: 25, reps: null, seconds: 210 },
      { round: 4, part: 'run', pounds: null, meters: 400, reps: null, seconds: 120 },
    ])
    const input = { id: 'hyrox-1234', rpe: 7, distanceMeters: 1800, updatedAt: '2026-11-11T18:00:00.000Z' }
    // 31 minutes on the clock, less the two setting up.
    expect(liveLog(run, at(31), input)).toMatchObject({ status: 'done', minutes: 29, distanceMeters: null, stations: stationLogs(run) })
  })

  it('logs only the rounds finished, Partial, when it ends early', () => {
    let run = onRound1(hyroxRun(1))
    run = end(nextBlock(nextBlock(run, at(10)), at(13)), at(25))
    // Round 2's Station was done, but the round wasn't.
    run = { ...run, legs: [...run.legs, { block: 3, seconds: 200 }] }
    expect(stationLogs(run).filter((l) => l.part === 'round')).toEqual([
      { round: 1, part: 'round', pounds: null, meters: null, reps: null, seconds: 360 },
    ])
    expect(liveStatusOf(run)).toBe('partial')
  })

  it('goes back to a round on its last leg, the Station before it kept', () => {
    let run = onRound1(hyroxRun(1))
    run = legs(run, 10, 13)
    run = nextBlock(run, at(16))
    run = goBack(run, 2, at(17))
    expect(run).toMatchObject({ block: 2, splits: [], legs: [{ block: 2, seconds: 180 }] })
    expect(currentLeg(run)).toBe(1)
    // The run's clock runs on from its 3:00.
    expect(legElapsed(run, at(18))).toBe(240)
    expect(redone(nextBlock(run, at(19)), 2)).toEqual([2])
  })

  it('logs only the round time for a round finished before legs were timed', () => {
    let run = onRound1(hyroxRun(1))
    run = legs(run, 10, 13)
    const old = { ...run, legs: [] }
    expect(stationLogs(old).filter((l) => l.round === 1).map((l) => [l.part, l.seconds])).toEqual([
      ['round', 360],
      ['sled-push', null],
      ['run', null],
    ])
  })

  it('asks about a split quicker than anyone could go, and saves it put right or untimed', () => {
    let run = onRound1(hyroxRun(11, 'hyrox-b', '2027-01-20'))
    // 0:14 for 750 m on the SkiErg: its tap slipped. The run took the rest of it.
    run = nextBlock(run, at(7) + 14_000)
    run = tap(run, at(14))
    expect(quickSplits(run)).toEqual([
      { block: run.blocks.findIndex((b) => b.round === 1), leg: 0, seconds: 14, part: 'skierg', round: 1, meters: 750, reps: null, fastest: 113 },
    ])
    const [{ block }] = quickSplits(run)
    const line = (fixes: SplitFix[]) => stationLogs(run, fixes).find((l) => l.round === 1 && l.part === 'skierg')!.seconds
    expect(line([{ block, leg: 0, seconds: 200 }])).toBe(200)
    expect(line([{ block, leg: 0, seconds: null }])).toBeNull()
    const input = { id: 'hyrox-1234', rpe: 8, distanceMeters: null, updatedAt: '', fixes: [{ block, leg: 0, seconds: 200 }] }
    expect(liveLog(run, at(30), input).stations.find((l) => l.part === 'skierg')!.seconds).toBe(200)
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

describe('Compromised intervals', () => {
  it('runs each rep as a round: the 1 km at Race run pace first, then 20 wall balls', () => {
    const reps = liveBlocks(session(6, 'run')).filter((b) => b.kind === 'round')
    expect(reps).toHaveLength(4)
    for (const block of reps) {
      expect(block).toMatchObject({ meters: 1000, runFirst: true, effort: { pace: 'race-run' } })
      expect(block.stations).toEqual([{ station: 'wall-balls', meters: null, reps: 20, pounds: 13 }])
      expect(roundLegs(block)).toEqual(['run', 'wall-balls'])
    }
  })

  it('logs the run, then the wall balls, each with its split', () => {
    let run = startRun({ week: 6, session: session(6, 'run'), date: localDate('2026-12-16'), environment: 'indoor' }, T0)
    run = go(run, at(10))
    expect(run.blocks[run.block].name).toBe('Round 1 of 4')
    run = legs(run, 14.5, 16)
    expect(stationLogs(run)).toEqual([
      { round: 1, part: 'round', pounds: null, meters: null, reps: null, seconds: 360 },
      { round: 1, part: 'run', pounds: null, meters: 1000, reps: null, seconds: 270 },
      { round: 1, part: 'wall-balls', pounds: 13, meters: null, reps: 20, seconds: 90 },
    ])
  })
})

describe('split warm-ups and the HYROX Set up', () => {
  it('jogs the drills run’s warm-up for 7 minutes, then ticks off its Drills', () => {
    const [warmUp, drills, plyo] = liveBlocks(drillsRun('by-feel'))
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
  })

  it('jogs the Compromised run test’s warm-up for 8 minutes, then ticks off 2 strides', () => {
    const test = liveBlocks(session(2, 'compromised-run-test'))
    expect(test.slice(0, 3).map((b) => [b.name, b.kind, b.seconds])).toEqual([
      ['Warm-up', 'warm-up', 480],
      ['Strides', 'drills', null],
      ['Run 1', 'distance', null],
    ])
    expect(test[1].checklist).toEqual(['Strides · 1 of 2', 'Strides · 2 of 2'])
  })

  it('jogs HYROX’s warm-up for 5 minutes, then sets up every Station at its Race load', () => {
    const blocks = liveBlocks(session(1, 'hyrox-a'))
    expect(blocks.slice(0, 3).map((b) => [b.name, b.kind, b.seconds, b.work])).toEqual([
      ['Warm-up', 'warm-up', 300, false],
      ['Set up', 'setup', null, false],
      ['Round 1 of 4', 'round', null, true],
    ])
    expect(blocks[1]).toMatchObject({ checklist: [], round: null, effort: null })
    expect(blocks[1].stations).toEqual([
      { station: 'sled-push', meters: null, reps: null, pounds: 335 },
      { station: 'sled-pull', meters: null, reps: null, pounds: 225 },
      { station: 'farmers-carry', meters: null, reps: null, pounds: 55 },
      { station: 'sandbag-lunges', meters: null, reps: null, pounds: 45 },
    ])
    expect(blocks[1].detail).toEqual([])
  })

  it('sets up only the Stations with a load, and says once that nothing else needs loading', () => {
    const setUp = liveBlocks(session(1, 'hyrox-b')).find((b) => b.kind === 'setup')!
    expect(setUp.stations).toEqual([{ station: 'wall-balls', meters: null, reps: null, pounds: 13 }])
    expect(setUp.detail).toEqual(['Nothing else to load.'])
  })

  const hyrox = () => startRun({ week: 1, session: session(1, 'hyrox-a'), date: localDate('2026-11-11'), environment: 'indoor' }, T0)
  /** On Set up, straight after the warm-up. */
  const onSetUp = () => advance(hyrox(), at(5))

  it('runs Set up on a stopwatch that ends with Done, then holds round 1 on Ready', () => {
    let run = onSetUp()
    expect(run).toMatchObject({ block: 1, ready: false, pausedAt: null })
    expect(blockLeft(run, at(9))).toBeNull()
    expect(blockElapsed(run, at(9))).toBe(240)
    expect(advance(run, at(40))).toBe(run)

    run = nextBlock(run, at(12))
    expect(run).toMatchObject({ block: 2, ready: true, pausedAt: at(12), skipped: [], splits: [] })
    expect(canUndo(run, at(12) + 5000)).toBe(true)
    expect(undo(run, at(12) + 5000)).toMatchObject({ block: 1, ready: false })
  })

  it('leaves Set up out of the active time and the log’s minutes', () => {
    let run = nextBlock(onSetUp(), at(12))
    run = resume(run, at(13))
    for (const t of [17, 21, 25, 29]) run = legs(run, t - 2, t)
    run = advance(run, at(33))
    expect(isOver(run)).toBe(true)
    // 33 minutes on the clock, less a minute on Ready and seven setting up.
    expect(activeSeconds(run, at(33))).toBe(25 * 60)
    expect(liveLog(run, at(33), { id: 'x', rpe: 7, distanceMeters: null, updatedAt: '' }).minutes).toBe(25)
  })

  it('leaves Set up out of the active time when the Session ends during it', () => {
    const run = end(onSetUp(), at(10))
    expect(activeSeconds(run, at(10))).toBe(5 * 60)
    expect(activeSeconds(goBack(nextBlock(onSetUp(), at(12)), 1, at(14)), at(15))).toBe(5 * 60)
  })
})

const liveStatusOf = (run: LiveRun) => liveLog(run, at(60), { id: 'x', rpe: 7, distanceMeters: null, updatedAt: '' }).status

describe('Race simulations', () => {
  const sim = (week: number) => liveBlocks(session(week, 'race-simulation'))
  const legs = (week: number) =>
    sim(week)
      .filter((b) => b.round !== null)
      .map((b) => (b.kind === 'distance' ? `run ${b.meters} m` : `${b.stations[0].station} ${b.stations[0].meters ?? b.stations[0].reps} @ ${b.stations[0].pounds}`))

  it('runs Week 16 as half simulation A: a split for each 1 km run and each of Stations 1–4, in race order', () => {
    expect(sim(16).map((b) => [b.name, b.kind, b.seconds])).toEqual([
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
    expect(legs(16)).toEqual([
      'run 1000 m', 'skierg 1000 @ null', 'run 1000 m', 'sled-push 50 @ 335', 'run 1000 m', 'sled-pull 50 @ 225', 'run 1000 m',
      'burpee-broad-jumps 80 @ null',
    ])
  })

  it('runs Week 18 as half simulation B over Stations 5–8 at race volume', () => {
    expect(legs(18)).toEqual([
      'run 1000 m', 'row 1000 @ null', 'run 1000 m', 'farmers-carry 200 @ 55', 'run 1000 m', 'sandbag-lunges 100 @ 45', 'run 1000 m',
      'wall-balls 100 @ 13',
    ])
  })

  it('runs Week 21 as eight full 1 km runs with every Station at half race volume and Race load', () => {
    expect(legs(21)).toEqual([
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
    let run = startRun({ week: 16, session: session(16, 'race-simulation'), date: localDate('2027-02-24'), environment: 'indoor' }, T0)
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

describe('the Compromised run test', () => {
  it('runs four 1 km runs at full effort, each then a Station at half race volume and Race load', () => {
    const blocks = liveBlocks(session(2, 'compromised-run-test'))
    expect(blocks.map((b) => [b.name, b.kind])).toEqual([
      ['Warm-up', 'warm-up'],
      ['Strides', 'drills'],
      ['Run 1', 'distance'],
      ['SkiErg', 'station'],
      ['Run 2', 'distance'],
      ['Sled push', 'station'],
      ['Run 3', 'distance'],
      ['Row', 'station'],
      ['Run 4', 'distance'],
      ['Wall balls', 'station'],
      ['Cooldown', 'cooldown'],
    ])
    expect(blocks.filter((b) => b.kind === 'distance').every((b) => b.meters === 1000 && b.effort && 'feel' in b.effort && b.effort.feel === 'all-out')).toBe(true)
    expect(blocks.filter((b) => b.kind === 'station').map((b) => b.stations[0])).toEqual([
      { station: 'skierg', meters: 500, reps: null, pounds: null },
      { station: 'sled-push', meters: 25, reps: null, pounds: 335 },
      { station: 'row', meters: 500, reps: null, pounds: null },
      { station: 'wall-balls', meters: null, reps: 50, pounds: 13 },
    ])
  })
})

describe('parseLiveRun for HYROX', () => {
  it('takes back a HYROX session in progress', () => {
    const run = nextBlock(onRound1(startRun({ week: 1, session: session(1, 'hyrox-a'), date: localDate('2026-11-11'), environment: 'indoor' }, T0)), at(10))
    expect(run.legs).toHaveLength(1)
    expect(parseLiveRun(JSON.parse(JSON.stringify(run)))).toEqual(run)
  })

  it('takes back one stored before rounds were timed leg by leg, on the round’s first leg', () => {
    const { legs: _, ...old } = onRound1(startRun({ week: 1, session: session(1, 'hyrox-a'), date: localDate('2026-11-11'), environment: 'indoor' }, T0))
    const parsed = parseLiveRun(JSON.parse(JSON.stringify(old)))!
    expect(parsed.legs).toEqual([])
    expect(currentLeg(parsed)).toBe(0)
  })

  it('takes back a round stored before rounds ran Station first as run first, as it was run', () => {
    const run = onRound1(startRun({ week: 1, session: session(1, 'hyrox-a'), date: localDate('2026-11-11'), environment: 'indoor' }, T0))
    const blocks = run.blocks.map(({ runFirst: _, ...b }) => b)
    const parsed = parseLiveRun(JSON.parse(JSON.stringify({ ...run, blocks })))!
    expect(roundLegs(parsed.blocks[parsed.block])).toEqual(['run', 'sled-push'])
  })
})

describe('sessionRpe', () => {
  it('guesses a Session’s Overall RPE as Live’s finish sheet does, for every Session of a Week', () => {
    for (const s of findWeek(program, 3)!.sessions) expect(sessionRpe(s)).toBe(predictedRpe(start(s)))
    expect(sessionRpe(session(3, 'easy'))).toBeLessThan(sessionRpe(session(3, 'hyrox-a')))
  })
})
