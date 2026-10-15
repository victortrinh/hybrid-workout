/**
 * A Live session of running: the resolved Prescription laid out as Blocks to
 * run one after the other, and the clock that walks through them. HYROX runs
 * on the same clock, a Block per round; a Race simulation, a Block per run
 * and per Station, so each gets its split.
 *
 * Pure like the Coach: no timers, no storage. Every step takes `now` (epoch
 * milliseconds) from the caller. The state is timestamps rather than counters,
 * so a reload or a locked phone loses nothing: whatever time passed is still
 * there when the page looks again, and `advance` catches up in one go.
 */
import type { LocalDate } from './calendar'
import type { IntervalLog, SessionLog, StationLog } from './log'
import {
  clock,
  DEFAULT_INCLINE,
  paceFor,
  runTarget,
  speedFor,
  UNIT_LABEL,
  type Environment,
  type RunContext,
} from './paces'
import { SESSION_TYPES, stationPounds } from './program/describe'
import { stations } from './program/program'
import type { Block, Exercise, Lane, RunEffort, Session, SessionType, StationId } from './program/types'

/** The Session types that are only running: their reps get Held it or Changed. */
export const LIVE_RUN_TYPES: readonly SessionType[] = ['speed', 'threshold', 'easy', '5k-test']

export const isLiveRun = (session: Session) => LIVE_RUN_TYPES.includes(session.type)

/** Runs and Stations: logged as Station logs. */
export const CIRCUIT_TYPES: readonly SessionType[] = ['hyrox', 'race-simulation']

export const isCircuit = (session: Session) => CIRCUIT_TYPES.includes(session.type)

/** Everything Start session runs. */
const LIVE_TYPES: readonly SessionType[] = [...LIVE_RUN_TYPES, ...CIRCUIT_TYPES]

/** A Session Start session runs, as long as it still has running in it: not one the pain rules made easy bike. */
export const isLive = (session: Session) =>
  LIVE_TYPES.includes(session.type) &&
  session.blocks.some((b) => b.exercises.some((e) => e.prescription.kind === 'run' || e.prescription.kind === 'intervals'))

export type LiveBlockKind =
  | 'warm-up'
  | 'drills'
  | 'rep'
  | 'recovery'
  | 'run'
  | 'distance'
  | 'cooldown'
  /** A HYROX round: its run and its Stations, timed as one. */
  | 'round'
  /** One Station of a Race simulation, timed on its own. */
  | 'station'

/** A Station as a round prescribes it, or as it was actually done once changed. */
export interface LiveStation {
  station: StationId
  meters: number | null
  reps: number | null
  /** Per implement, rounded to 5 lb; plates alone on a sled. Null where the Station has no load. */
  pounds: number | null
}

export interface LiveBlock {
  /** "Warm-up", "Rep 2 of 5", "Jog", "5 km" */
  name: string
  kind: LiveBlockKind
  /** Null for a Block run to a distance rather than a time: the 5 km of a 5K test. */
  seconds: number | null
  meters: number | null
  lane: Lane
  /** The rep's number, for the reps of an interval set: each ends with Held it or Changed. */
  rep: number | null
  /** A HYROX round's number, or the place of a Race simulation's run and its Station. */
  round: number | null
  /** A round's Stations, or a Race simulation Station's one. Empty for everything else. */
  stations: LiveStation[]
  /** Null where the Block isn't a run at a target: drills, plyometrics. */
  effort: RunEffort | null
  /** What the Session is for: a rep, the 5 km, the Easy run. Cutting it short makes the log Partial. */
  work: boolean
  /** Everything else the Block asks for: "Leg swings, skips, drills", "Strides 4 × 15″". */
  detail: string[]
  /**
   * A checklist Block's sets, one row each to tick: "Pogo jumps · set 1 of 2".
   * Its clock counts up, and it ends on the last tick or Done. Empty for every other Block.
   */
  checklist: string[]
}

const RECOVERY_EFFORT: RunEffort = { pace: 'easy' }

/**
 * The Session's Blocks, with interval sets opened out into reps and
 * recoveries, HYROX as a Block per round, and a Race simulation as a Block
 * per run and per Station, in race order.
 */
export function liveBlocks(session: Session): LiveBlock[] {
  const lane = SESSION_TYPES[session.type].lane
  const rounds = session.blocks.filter(isRound).length
  let round = 0
  return session.blocks.flatMap((block): LiveBlock[] => {
    const kind = blockKind(block)
    const base = { meters: null, rep: null, round: null, stations: [] as LiveStation[], detail: [] as string[], checklist: [] as string[] }

    if (isRound(block)) {
      round += 1
      const run = block.exercises.find((e) => e.prescription.kind === 'run')?.prescription
      const runMeters = run?.kind === 'run' ? (run.meters ?? null) : null
      const legs = block.exercises.flatMap(liveStation)
      if (session.type === 'race-simulation') {
        return [
          {
            ...base,
            name: `Run ${round}`,
            kind: 'distance',
            seconds: null,
            meters: runMeters,
            lane,
            round,
            effort: run?.kind === 'run' ? (run.effort ?? null) : null,
            work: true,
          },
          ...legs.map(
            (leg): LiveBlock => ({
              ...base,
              name: stations[leg.station].name,
              kind: 'station',
              seconds: null,
              lane,
              round,
              stations: [leg],
              effort: null,
              work: true,
            }),
          ),
        ]
      }
      return [
        {
          ...base,
          name: `Round ${round} of ${rounds}`,
          kind: 'round',
          seconds: null,
          meters: runMeters,
          lane,
          round,
          stations: legs,
          effort: null,
          work: true,
        },
      ]
    }

    const intervals = block.exercises.find((e) => e.prescription.kind === 'intervals')?.prescription
    if (intervals?.kind === 'intervals') {
      return Array.from({ length: intervals.reps * 2 - 1 }, (_, i): LiveBlock => {
        const rep = i / 2 + 1
        return i % 2 === 0
          ? {
              ...base,
              name: `Rep ${rep} of ${intervals.reps}`,
              kind: 'rep',
              seconds: intervals.workSeconds,
              lane,
              rep,
              effort: intervals.effort,
              work: true,
            }
          : {
              ...base,
              name: intervals.recovery === 'jog' ? 'Jog' : 'Walk',
              kind: 'recovery',
              seconds: intervals.recoverySeconds,
              lane: 'easy',
              effort: intervals.recovery === 'jog' ? RECOVERY_EFFORT : null,
              work: false,
            }
      })
    }

    const run = block.exercises.find((e) => e.prescription.kind === 'run')
    const detail = block.exercises.filter((e) => e !== run).map(exerciseWords)
    if (run?.prescription.kind === 'run') {
      const rx = run.prescription
      if (rx.meters) {
        return [{ ...base, name: block.name, kind: 'distance', seconds: null, meters: rx.meters, lane, effort: rx.effort ?? null, work: true, detail }]
      }
      const minutes = block.minutes ?? rx.minutes
      return [
        {
          ...base,
          name: block.name,
          kind,
          seconds: minutes === undefined ? null : Math.round(minutes * 60),
          lane: kind === 'run' ? lane : 'easy',
          effort: rx.effort ?? null,
          work: kind === 'run',
          detail,
        },
      ]
    }

    // No run to target: drills, or a walk to warm up or cool down.
    const walk = kind === 'warm-up' || kind === 'cooldown'
    const checklist = walk ? [] : checklistRows(block.exercises)
    return [
      {
        ...base,
        name: block.name,
        kind: walk ? kind : 'drills',
        seconds: block.minutes === undefined || checklist.length > 0 ? null : Math.round(block.minutes * 60),
        lane: walk ? 'easy' : lane,
        effort: null,
        work: false,
        detail,
        checklist,
      },
    ]
  })
}

/**
 * A row per set to tick, when every Exercise is counted in sets: "Pogo jumps ·
 * set 1 of 2", "Accelerations · 1 of 4". Empty when one isn't, so the Block
 * stays on the clock.
 */
export function checklistRows(exercises: Exercise[]): string[] {
  const rows = exercises.map(({ name, prescription: rx }): string[] | null => {
    switch (rx.kind) {
      case 'sets':
        return Array.from({ length: rx.sets }, (_, i) => `${name} · set ${i + 1} of ${rx.sets}`)
      case 'accelerations':
      case 'strides':
        return Array.from({ length: rx.reps }, (_, i) => `${name} · ${i + 1} of ${rx.reps}`)
      default:
        return null
    }
  })
  return rows.length > 0 && rows.every((r) => r !== null) ? rows.flat() as string[] : []
}

/** A Block of sets to tick rather than a clock to run down. */
export const isChecklist = (block: LiveBlock) => block.checklist.length > 0

/** A Block of a run and Stations: a HYROX round, or a Race simulation's run and its Station. */
const isRound = (block: Block) => block.exercises.some((e) => e.prescription.kind === 'station')

/** A Station Exercise at its share of Race load, in pounds. */
function liveStation({ prescription: rx }: Exercise): LiveStation[] {
  if (rx.kind !== 'station') return []
  return [
    {
      station: rx.station,
      meters: rx.meters ?? null,
      reps: rx.reps ?? null,
      pounds: stationPounds(stations[rx.station], rx.raceLoadPercent ?? 100),
    },
  ]
}

function blockKind(block: Block): LiveBlockKind {
  if (/warm-up/i.test(block.name)) return 'warm-up'
  if (/cooldown/i.test(block.name)) return 'cooldown'
  return block.main ? 'run' : 'drills'
}

/** "Pogo jumps 2 × 15", "Accelerations 4 × 15 m at 80–90%", "Strides 4 × 15″" */
function exerciseWords({ name, prescription: rx }: Exercise): string {
  const range = ([low, high]: readonly [number, number]) => (low === high ? `${low}` : `${low}–${high}`)
  switch (rx.kind) {
    case 'sets':
      return `${name} ${rx.sets} × ${typeof rx.reps === 'number' ? rx.reps : range(rx.reps)}`
    case 'strides':
      return `${name} ${rx.reps} × ${rx.seconds}″`
    case 'accelerations':
      return `${name} ${rx.reps} × ${rx.meters} m at ${range(rx.percentOfMax)}%`
    case 'sprints':
      return [name, rx.seconds && `${range(rx.seconds)}″`, rx.meters && `${range(rx.meters)} m`].filter(Boolean).join(' ')
    default:
      return name
  }
}

/** The target a Block is run at, as the hero figure reads it. */
export interface LiveTarget {
  /** "12.3" on the treadmill, "4:52" outdoors, "6–7" while runs are RPE only. */
  value: string
  /** "km/h", "mph", "/km" or "RPE". */
  unit: string
  /** Treadmill incline in %, indoors only. */
  incline: number | null
  /** Seconds per km, for the interval log; null while runs are RPE only. */
  pace: number | null
  /** The whole target in words: "9.2–10.3 km/h · 1% incline". */
  words: string
}

/**
 * The exact target of a Block: the middle of its pace range as a treadmill
 * speed or a pace per km, or its RPE before there are Training paces. Null
 * where there's nothing to dial: drills, or a run by feel with no RPE.
 */
export function liveTarget(block: LiveBlock, run: RunContext): LiveTarget | null {
  if (!block.effort) return null
  const incline = run.environment === 'indoor' ? DEFAULT_INCLINE : null
  const range = run.paces && paceFor(block.effort, run.paces)
  if (range) {
    const pace = Math.round((range[0] + range[1]) / 2)
    const words = runTarget(block.effort, run) ?? ''
    return run.environment === 'indoor'
      ? { value: speedFor(pace, run.unit).toFixed(1), unit: UNIT_LABEL[run.unit], incline, pace, words }
      : { value: clock(pace), unit: '/km', incline, pace, words }
  }
  const rpe = block.effort.rpe
  if (!rpe) return null
  const value = rpe[0] === rpe[1] ? `${rpe[0]}` : `${rpe[0]}–${rpe[1]}`
  return { value, unit: 'RPE', incline, pace: null, words: `RPE ${value}` }
}

/** A Live run session in progress, as stored on the device. */
export interface LiveRun {
  week: number
  sessionId: string
  type: SessionType
  /** "Threshold, 2 × 12′" */
  heading: string
  /** The day it's done on, in America/Toronto. */
  date: LocalDate
  environment: Environment
  /** Taken from the Prescription at Start, so nothing that changes later moves the clock. */
  blocks: LiveBlock[]
  startedAt: number
  /** The current Block; `blocks.length` once the last one is over. */
  block: number
  blockStartedAt: number
  /** Since when it's paused; null while the clock runs. */
  pausedAt: number | null
  /** Time paused in the current Block, and in the whole Session, not counting a pause still open. */
  blockPausedMs: number
  pausedMs: number
  /** Work Blocks cut short with Skip block. */
  skipped: number[]
  /** Blocks ended with Skip block or Done, or the last tick, with the seconds they had run. */
  cutShort: { block: number; seconds: number }[]
  /**
   * The clock holds on the Ready screen before the current Block: a work
   * Block after one that isn't, or a HYROX round. It's a pause, so the wait
   * counts nowhere; Start is `resume`.
   */
  ready: boolean
  /** The current checklist Block's sets ticked. Only a guide: never logged. */
  ticked: number[]
  /** Blocks run to a distance, with the seconds they took. */
  splits: { block: number; seconds: number }[]
  /**
   * Blocks that are over and still waiting for an answer, oldest first: reps
   * for Held it or Changed, HYROX rounds and Race simulation Stations for As
   * written or Changed. A round or Station left unanswered logs as written.
   */
  asks: number[]
  intervals: IntervalLog[]
  /** End was tapped: the clock is paused on the finish sheet until Keep going. */
  ending: boolean
  /** When the last Block ended; null until then. */
  finishedAt: number | null
  /** The run as it was before Skip block or Done, and when that was tapped: Undo for a few seconds. */
  undo: { run: LiveRun; at: number } | null
  /** Partial flipped to Done on the finish sheet: what was cut short didn't matter. */
  markedDone: boolean
}

export interface LiveStart {
  week: number
  session: Session
  date: LocalDate
  environment: Environment
}

export function startRun({ week, session, date, environment }: LiveStart, now: number): LiveRun {
  return {
    week,
    sessionId: session.id,
    type: session.type,
    heading: `${SESSION_TYPES[session.type].name}, ${session.headline}`,
    date,
    environment,
    blocks: liveBlocks(session),
    startedAt: now,
    block: 0,
    blockStartedAt: now,
    pausedAt: null,
    blockPausedMs: 0,
    pausedMs: 0,
    skipped: [],
    cutShort: [],
    ready: false,
    ticked: [],
    splits: [],
    asks: [],
    intervals: [],
    ending: false,
    finishedAt: null,
    undo: null,
    markedDone: false,
  }
}

/** The last Block is over, or End was tapped: time for the finish sheet. */
export const isOver = (run: LiveRun) => run.block >= run.blocks.length || run.ending

/** Seconds run in the current Block, paused time left out. */
export function blockElapsed(run: LiveRun, now: number): number {
  if (run.block >= run.blocks.length) return 0
  return Math.max(0, ((run.pausedAt ?? now) - run.blockStartedAt - run.blockPausedMs) / 1000)
}

/** Seconds left in the current Block, or null for a Block run to a distance. */
export function blockLeft(run: LiveRun, now: number): number | null {
  const seconds = run.blocks[run.block]?.seconds
  return seconds === null || seconds === undefined ? null : Math.max(0, seconds - blockElapsed(run, now))
}

/**
 * Moves past every timed Block whose time is up by `now`, however many: a
 * phone locked through two reps comes back on the third, with both reps
 * waiting for Held it. Returns the same object when nothing changed.
 */
export function advance(run: LiveRun, now: number): LiveRun {
  if (run.pausedAt !== null) return run
  let next = run
  while (next.block < next.blocks.length) {
    const seconds = next.blocks[next.block].seconds
    if (seconds === null) break
    const endsAt = next.blockStartedAt + next.blockPausedMs + seconds * 1000
    if (now < endsAt) break
    next = moveOn(next, endsAt, null)
    if (next.pausedAt !== null) break
  }
  return next
}

/** The Blocks that ask something once over: a rep, a HYROX round, a Race simulation's Station. */
const asks = (block: LiveBlock) => block.rep !== null || block.kind === 'round' || block.kind === 'station'

/**
 * Whether the clock holds on Ready before Block `i`: a work Block after
 * warm-up, drills or anything else that isn't work, or a HYROX round. Never
 * between a rep and its recovery, nor between a Race simulation's runs and Stations.
 */
function holdsBefore(blocks: LiveBlock[], i: number): boolean {
  const block = blocks[i]
  const before = blocks[i - 1]
  if (!block || !before || !block.work) return false
  return block.kind === 'round' || (!before.work && before.kind !== 'recovery')
}

/** On to the next Block. `cut` is the tap that ended this one early, with its seconds run. */
function moveOn(run: LiveRun, at: number, cut: { skipped: boolean; seconds: number } | null): LiveRun {
  const block = run.block + 1
  const ready = holdsBefore(run.blocks, block)
  return {
    ...run,
    asks: asks(run.blocks[run.block]) ? [...run.asks, run.block] : run.asks,
    skipped: cut?.skipped ? [...run.skipped, run.block] : run.skipped,
    cutShort: cut ? [...run.cutShort, { block: run.block, seconds: cut.seconds }] : run.cutShort,
    block,
    blockStartedAt: at,
    blockPausedMs: 0,
    pausedAt: ready ? (run.pausedAt ?? at) : run.pausedAt,
    ready,
    ticked: [],
    finishedAt: block >= run.blocks.length ? at : null,
    undo: null,
  }
}

export function pause(run: LiveRun, now: number): LiveRun {
  const current = advance(run, now)
  if (current.pausedAt !== null || current.block >= current.blocks.length) return current
  return { ...current, pausedAt: now }
}

/** Resume, Start on the Ready screen, or Keep going on the finish sheet (back to Ready, if that's where it ended). */
export function resume(run: LiveRun, now: number): LiveRun {
  if (run.pausedAt === null) return run
  if (run.ending && run.ready) return { ...run, ending: false, markedDone: false }
  const paused = Math.max(0, now - run.pausedAt)
  return {
    ...run,
    pausedAt: null,
    blockPausedMs: run.blockPausedMs + paused,
    pausedMs: run.pausedMs + paused,
    ready: false,
    ending: false,
    markedDone: false,
  }
}

/**
 * Skip block on a timed work Block, which makes the log Partial; Done on
 * warm-up, drills, a checklist or the cooldown, which doesn't. On a Block run
 * to a distance, a HYROX round or a Station, the tap that says it's covered,
 * which records its split. Paused stays paused, on the next Block.
 */
export function nextBlock(run: LiveRun, now: number): LiveRun {
  const current = advance(run, now)
  return finishBlock(current, now, current)
}

/** Ends the current Block on a tap; Skip block and Done can be undone back to `before`. */
function finishBlock(current: LiveRun, now: number, before: LiveRun): LiveRun {
  if (current.block >= current.blocks.length) return current
  const at = current.pausedAt ?? now
  const block = current.blocks[current.block]
  const seconds = Math.round(blockElapsed(current, now))
  if (block.seconds === null && !isChecklist(block)) {
    return moveOn({ ...current, splits: [...current.splits, { block: current.block, seconds }] }, at, null)
  }
  const next = moveOn(current, at, { skipped: block.work, seconds })
  return { ...next, undo: { run: { ...before, undo: null }, at: now } }
}

/** Ticks a checklist Block's set, or unticks it. The last one ticked ends the Block. */
export function tick(run: LiveRun, row: number, now: number): LiveRun {
  const current = advance(run, now)
  const block = current.blocks[current.block]
  if (!block || row < 0 || row >= block.checklist.length) return current
  const ticked = current.ticked.includes(row) ? current.ticked.filter((r) => r !== row) : [...current.ticked, row].sort((a, b) => a - b)
  const next = { ...current, ticked }
  return ticked.length === block.checklist.length ? finishBlock(next, now, current) : next
}

/** How long Undo stays offered after Skip block or Done. */
export const UNDO_MS = 8_000

export const canUndo = (run: LiveRun, now: number) => run.undo !== null && now - run.undo.at < UNDO_MS

/**
 * Back to the Block before Skip block or Done, exactly as it was. Its clock
 * kept running, so the seconds since the tap count toward it.
 */
export function undo(run: LiveRun, now: number): LiveRun {
  return canUndo(run, now) ? { ...run.undo!.run, undo: null } : run
}

/** The Blocks from `block` on with something recorded that going back to it drops: skips, splits, answers. */
export function redone(run: LiveRun, block: number): number[] {
  const recorded = new Set([...run.skipped, ...run.splits.map((s) => s.block), ...run.asks, ...run.intervals.map((i) => i.block)])
  return [...recorded].filter((b) => b >= block).sort((a, b) => a - b)
}

/**
 * Back to an earlier Block, tapped in the lane list. One cut short resumes
 * where it was left; one run to a distance, a round or a Station picks up
 * its stopwatch from its split; a timed one that ran its time starts again.
 * The gap is paused for the Block, but the time stays in the Session's.
 * Everything recorded from that Block on is dropped, to be done again.
 */
export function goBack(run: LiveRun, block: number, now: number): LiveRun {
  if (block < 0 || block >= Math.min(run.block, run.blocks.length)) return run
  const paused = run.pausedAt === null ? 0 : Math.max(0, now - run.pausedAt)
  const from =
    run.cutShort.find((c) => c.block === block)?.seconds ?? run.splits.find((s) => s.block === block)?.seconds ?? 0
  const before = (b: number) => b < block
  return {
    ...run,
    block,
    blockStartedAt: now - from * 1000,
    blockPausedMs: 0,
    pausedAt: null,
    pausedMs: run.pausedMs + paused,
    skipped: run.skipped.filter(before),
    cutShort: run.cutShort.filter((c) => before(c.block)),
    splits: run.splits.filter((s) => before(s.block)),
    asks: run.asks.filter(before),
    intervals: run.intervals.filter((i) => before(i.block)),
    ready: false,
    ticked: [],
    ending: false,
    finishedAt: null,
    undo: null,
    markedDone: false,
  }
}

/**
 * The work cut short, for the finish sheet: each Block skipped or ended in,
 * with the seconds it ran, and each never reached (seconds null).
 */
export function shortBlocks(run: LiveRun): { block: number; seconds: number | null }[] {
  return run.blocks.flatMap((b, i) => {
    if (!b.work) return []
    if (run.skipped.includes(i)) return [{ block: i, seconds: run.cutShort.find((c) => c.block === i)?.seconds ?? null }]
    if (i === run.block && !run.ready) return [{ block: i, seconds: Math.round(blockElapsed(run, run.pausedAt ?? run.blockStartedAt)) }]
    return i >= run.block ? [{ block: i, seconds: null }] : []
  })
}

/** The finish sheet's flip: Partial logged as Done after all, or back. */
export const markDone = (run: LiveRun, done: boolean): LiveRun => ({ ...run, markedDone: done })

/** End: pauses and opens the finish sheet. Keep going is `resume`. */
export function end(run: LiveRun, now: number): LiveRun {
  const paused = pause(run, now)
  return paused.block >= paused.blocks.length ? paused : { ...paused, ending: true, undo: null }
}

/** Held it (`actualPace` null) or Changed, for a rep that's over. */
export function answer(run: LiveRun, block: number, targetPace: number | null, actualPace: number | null): LiveRun {
  const rep = run.blocks[block]?.rep
  if (rep === null || rep === undefined || !run.asks.includes(block)) return run
  return {
    ...run,
    undo: null,
    asks: run.asks.filter((b) => b !== block),
    intervals: [
      ...run.intervals,
      { block, rep, targetPace, held: actualPace === null, actualPace },
    ].sort((a, b) => a.block - b.block),
  }
}

/**
 * Every rep still waiting on Held it or Changed, answered Held it: silence
 * means the target was held. A rep cut short with Skip block isn't held, so it stays out.
 */
export function heldUnanswered(run: LiveRun, context: RunContext): LiveRun {
  return run.asks.reduce((next, block) => {
    const b = run.blocks[block]
    if (b.rep === null || run.skipped.includes(block)) return next
    return answer(next, block, liveTarget(b, context)?.pace ?? null, null)
  }, run)
}

/** What a HYROX round or a Race simulation Station actually was, when it wasn't as written. */
export interface StationChange {
  /** A HYROX round's run. */
  runMeters?: number
  stations: LiveStation[]
}

/**
 * As written (`change` null) or Changed, for a round or Station that's over.
 * A changed load carries on to the same Station in the rounds still to come.
 */
export function answerStations(run: LiveRun, block: number, change: StationChange | null): LiveRun {
  if (!run.asks.includes(block) || !(run.blocks[block]?.kind === 'round' || run.blocks[block]?.kind === 'station')) {
    return run
  }
  const answered = { ...run, asks: run.asks.filter((b) => b !== block), undo: null }
  if (!change) return answered
  const loads = new Map(change.stations.map((s) => [s.station, s.pounds]))
  return {
    ...answered,
    blocks: run.blocks.map((b, i) => {
      if (i === block) {
        return { ...b, meters: b.kind === 'round' ? (change.runMeters ?? b.meters) : b.meters, stations: change.stations }
      }
      if (i < run.block) return b
      return { ...b, stations: b.stations.map((s) => (loads.has(s.station) ? { ...s, pounds: loads.get(s.station)! } : s)) }
    }),
  }
}

/**
 * The Station logs of the rounds and Stations finished: a HYROX round's
 * time, run and Stations; a Race simulation's split on every run and Station.
 */
export function stationLogs(run: LiveRun): StationLog[] {
  return run.blocks.flatMap((b, i): StationLog[] => {
    const split = run.splits.find((s) => s.block === i)
    if (b.round === null || !split) return []
    const round = b.round
    const seconds = Math.min(SPLIT_MAX, split.seconds)
    const done = b.stations.map(
      (s): StationLog => ({ round, part: s.station, pounds: s.pounds, meters: s.meters, reps: s.reps, seconds: null }),
    )
    const runLog = (time: number | null): StationLog => ({ round, part: 'run', pounds: null, meters: b.meters, reps: null, seconds: time })
    switch (b.kind) {
      case 'round':
        return [{ round, part: 'round', pounds: null, meters: null, reps: null, seconds }, runLog(null), ...done]
      case 'distance':
        return [runLog(seconds)]
      default:
        return done.map((d) => ({ ...d, seconds }))
    }
  })
}

/** Three hours: a split longer than that is a phone left running. */
const SPLIT_MAX = 3 * 3600

/** Seconds actually run: from Start to the end, pauses left out. */
export function activeSeconds(run: LiveRun, now: number): number {
  const endAt = run.finishedAt ?? run.pausedAt ?? now
  return Math.max(0, (endAt - run.startedAt - run.pausedMs) / 1000)
}

/** The time of the Block run to a distance, if it was covered: a 5K test's result. */
export function distanceSeconds(run: LiveRun): number | null {
  return run.splits.find((s) => run.blocks[s.block]?.kind === 'distance')?.seconds ?? null
}

/**
 * Done when every work Block ran its course; Partial when one was skipped or
 * never reached, however little was missing, unless flipped to Done on the finish sheet.
 */
export function liveStatus(run: LiveRun): 'done' | 'partial' {
  if (run.markedDone) return 'done'
  return run.blocks.every((b, i) => !b.work || (i < run.block && !run.skipped.includes(i))) ? 'done' : 'partial'
}

export interface LiveLogInput {
  id: string
  rpe: number | null
  /** The console's distance, indoors. */
  distanceMeters: number | null
  /** A 5K test's time; only kept on a Done 5K test. */
  resultSeconds: number | null
  updatedAt: string
}

/** What each Session type usually feels like overall, when its Blocks don't say. */
const TYPICAL_RPE: Record<SessionType, number> = {
  speed: 8,
  strength: 7,
  threshold: 7,
  hyrox: 8,
  easy: 4,
  '5k-test': 10,
  'race-simulation': 9,
}

/**
 * The Overall RPE the finish sheet starts on: the top of the hardest RPE the
 * Session's work asks for, else what its Session type usually feels like.
 */
export function predictedRpe(run: LiveRun): number {
  const asked = run.blocks.filter((b) => b.work).flatMap((b) => (b.effort?.rpe ? [b.effort.rpe[1]] : []))
  return asked.length > 0 ? Math.max(...asked) : TYPICAL_RPE[run.type]
}

/** The Session log a finished Live session saves. */
export function liveLog(run: LiveRun, now: number, input: LiveLogInput): SessionLog {
  const status = liveStatus(run)
  const circuit = CIRCUIT_TYPES.includes(run.type)
  return {
    id: input.id,
    week: run.week,
    sessionId: run.sessionId,
    date: run.date,
    status,
    minutes: Math.min(600, Math.max(1, Math.round(activeSeconds(run, now) / 60))),
    rpe: input.rpe,
    notes: null,
    resultSeconds: run.type === '5k-test' && status === 'done' ? input.resultSeconds : null,
    environment: run.environment,
    // A circuit's runs are logged one by one, not as a console total.
    distanceMeters: run.environment === 'indoor' && !circuit ? input.distanceMeters : null,
    intervals: run.intervals,
    stations: stationLogs(run),
    sets: [],
    updatedAt: input.updatedAt,
  }
}

/** A stored Live run, checked enough to trust: anything else is dropped and the athlete starts again. */
export function parseLiveRun(value: unknown): LiveRun | null {
  if (typeof value !== 'object' || value === null) return null
  const v = value as Partial<LiveRun>
  const numbers = [v.week, v.startedAt, v.block, v.blockStartedAt, v.blockPausedMs, v.pausedMs]
  if (!numbers.every((n) => typeof n === 'number' && Number.isFinite(n))) return null
  if (typeof v.sessionId !== 'string' || typeof v.heading !== 'string' || typeof v.date !== 'string') return null
  if (!LIVE_TYPES.includes(v.type as SessionType)) return null
  if (v.environment !== 'indoor' && v.environment !== 'outdoor') return null
  const lists = [v.blocks, v.skipped, v.splits, v.asks, v.intervals]
  if (!lists.every(Array.isArray) || v.blocks!.length === 0) return null
  if (v.pausedAt !== null && typeof v.pausedAt !== 'number') return null
  if (v.finishedAt !== null && typeof v.finishedAt !== 'number') return null
  // Blocks stored before HYROX ran live have no round or Stations; before checklists, no checklist.
  const blocks = v.blocks!.map((b: LiveBlock) => ({
    ...b,
    round: b.round ?? null,
    stations: b.stations ?? [],
    checklist: Array.isArray(b.checklist) ? b.checklist : [],
  }))
  // Runs stored before Done, Ready and Undo have none of them.
  const before = v.undo && typeof v.undo === 'object' && typeof v.undo.at === 'number' ? parseLiveRun(v.undo.run) : null
  return {
    ...v,
    blocks,
    ending: v.ending === true,
    cutShort: Array.isArray(v.cutShort) ? v.cutShort : [],
    ready: v.ready === true,
    ticked: Array.isArray(v.ticked) ? v.ticked : [],
    undo: before ? { run: before, at: v.undo!.at } : null,
    markedDone: v.markedDone === true,
  } as LiveRun
}
