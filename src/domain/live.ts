/**
 * A Live session of running: the resolved Prescription laid out as Blocks to
 * run one after the other, and the clock that walks through them. HYROX runs
 * on the same clock, a Block per round with a tap at the end of each leg; a
 * Race simulation, a Block per run and per Station. Either way every run and
 * every Station gets its split.
 *
 * Pure like the Coach: no timers, no storage. Every step takes `now` (epoch
 * milliseconds) from the caller. The state is timestamps rather than counters,
 * so a reload or a locked phone loses nothing: whatever time passed is still
 * there when the page looks again, and `advance` catches up in one go.
 */
import type { LocalDate } from './calendar'
import type { IntervalLog, SessionLog, StationLog, StationPart } from './log'
import {
  clock,
  DEFAULT_INCLINE,
  formatPace,
  paceFor,
  runTarget,
  speedFor,
  UNIT_LABEL,
  type Environment,
  type RunContext,
} from './paces'
import { drillAmount, SESSION_TYPES, stationPounds } from './program/describe'
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
  /** A HYROX round: its run, then its Stations, with a tap at the end of each leg. */
  | 'round'
  /** One Station of a Race simulation, timed on its own. */
  | 'station'
  /** HYROX's Set up: every Station with a load, at it, on a stopwatch that's never active time. */
  | 'setup'

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
  /** A round's Stations, a Race simulation Station's one, or every Station to set up. Empty for everything else. */
  stations: LiveStation[]
  /** Null where the Block isn't a run at a target: drills, plyometrics. */
  effort: RunEffort | null
  /** What the Session is for: a rep, the 5 km, the Easy run. Cutting it short makes the log Partial. */
  work: boolean
  /** Everything else the Block asks for: "Station prep", "Pogo jumps 2 × 15". */
  detail: string[]
  /**
   * A checklist Block's sets, one row each to tick: "Pogo jumps 15 · set 1 of 2".
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

    if (block.setup) {
      return [
        {
          ...base,
          name: block.name,
          kind: 'setup',
          seconds: null,
          lane,
          stations: block.exercises.flatMap(liveStation),
          effort: null,
          work: false,
          detail: block.note ? [block.note] : [],
        },
      ]
    }

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
 * A row per set to tick, when every Exercise is counted in sets: "Pogo jumps 15 ·
 * set 1 of 2", "Accelerations · 1 of 4", "A-skips 20 m · 1 of 2", "Bike sprints 8–10″". Empty when one
 * isn't, so the Block stays on the clock.
 */
export function checklistRows(exercises: Exercise[]): string[] {
  const rows = exercises.map((exercise): string[] | null => {
    const { name, prescription: rx } = exercise
    switch (rx.kind) {
      case 'sets': {
        const what = `${name} ${typeof rx.reps === 'number' ? rx.reps : range(rx.reps)}`
        return rx.sets === 1 ? [what] : Array.from({ length: rx.sets }, (_, i) => `${what} · set ${i + 1} of ${rx.sets}`)
      }
      case 'sprints':
        return [exerciseWords(exercise)]
      case 'accelerations':
      case 'strides':
        return Array.from({ length: rx.reps }, (_, i) => `${name} · ${i + 1} of ${rx.reps}`)
      case 'drill': {
        const what = `${name} ${drillAmount(rx)}`.trim()
        return rx.sets === 1 ? [what] : Array.from({ length: rx.sets }, (_, i) => `${what} · ${i + 1} of ${rx.sets}`)
      }
      default:
        return null
    }
  })
  return rows.length > 0 && rows.every((r) => r !== null) ? rows.flat() as string[] : []
}

/** A Block of sets to tick rather than a clock to run down. */
export const isChecklist = (block: LiveBlock) => block.checklist.length > 0

/** A Block of a run and Stations: a HYROX round, or a Race simulation's run and its Station. */
const isRound = (block: Block) => !block.setup && block.exercises.some((e) => e.prescription.kind === 'station')

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

const range = ([low, high]: readonly [number, number]) => (low === high ? `${low}` : `${low}–${high}`)

/** "Pogo jumps 2 × 15", "Accelerations 4 × 15 m at 80–90%", "Strides 4 × 15″" */
function exerciseWords({ name, prescription: rx }: Exercise): string {
  switch (rx.kind) {
    case 'sets':
      return `${name} ${rx.sets} × ${typeof rx.reps === 'number' ? rx.reps : range(rx.reps)}`
    case 'strides':
      return `${name} ${rx.reps} × ${rx.seconds}″`
    case 'drill':
      return `${name} ${rx.sets > 1 ? `${rx.sets} × ` : ''}${drillAmount(rx)}`.trim()
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
  /** The pace per km beside a treadmill speed, `{ value: '4:52', unit: '/km' }`; null anywhere else. */
  secondary: { value: string; unit: string } | null
  /** Treadmill incline in %, indoors only. */
  incline: number | null
  /** Seconds per km, for the interval log; null while runs are RPE only. */
  pace: number | null
  /** The hero figure in words, as the Ready line and Lock-screen cues read it: "12.3 km/h · 4:52/km · 1% incline". */
  figure: string
  /** The whole target in words: "9.2–10.3 km/h · 5:51–6:26/km · 1% incline". */
  words: string
}

/**
 * The exact target of a Block: the middle of its pace range as a treadmill
 * speed with its pace per km, or a pace per km alone outdoors, or its RPE
 * before there are Training paces. Null where there's nothing to dial:
 * drills, or a run by feel with no RPE.
 */
export function liveTarget(block: LiveBlock, run: RunContext): LiveTarget | null {
  if (!block.effort) return null
  const incline = run.environment === 'indoor' ? DEFAULT_INCLINE : null
  if (block.kind === 'recovery') return recoveryTarget(run, incline)
  const range = run.paces && paceFor(block.effort, run.paces)
  if (range) {
    const pace = Math.round((range[0] + range[1]) / 2)
    const figure = formatPace([pace, pace], run.environment, run.unit)
    const words = runTarget(block.effort, run) ?? ''
    return run.environment === 'indoor'
      ? {
          value: speedFor(pace, run.unit).toFixed(1),
          unit: UNIT_LABEL[run.unit],
          secondary: { value: clock(pace), unit: '/km' },
          incline,
          pace,
          figure,
          words,
        }
      : { value: clock(pace), unit: '/km', secondary: null, incline, pace, figure, words }
  }
  const rpe = block.effort.rpe
  if (!rpe) return null
  const value = rpe[0] === rpe[1] ? `${rpe[0]}` : `${rpe[0]}–${rpe[1]}`
  return { value, unit: 'RPE', secondary: null, incline, pace: null, figure: `RPE ${value}`, words: `RPE ${value}` }
}

/** A recovery jog's speed with no Training paces: slow, but not so slow the belt feels awkward. */
const RECOVERY_KMH = 7

/** How far under the slow end of Easy pace a recovery jog sits. */
const RECOVERY_UNDER_EASY_KMH = 0.5

/**
 * The speed suggested for a recovery jog, in km/h: the first of these there
 * is. No floor: a slow Easy pace makes a slow jog.
 */
export function recoveryKmh(run: RunContext): number {
  const underEasy = run.paces && speedFor(run.paces.easy[1], 'kmh') - RECOVERY_UNDER_EASY_KMH
  return Math.round((underEasy ?? RECOVERY_KMH) * 10) / 10
}

/** "Jog ~8.7 km/h, or walk": a number to set the belt to, never one to hold. */
function recoveryTarget(run: RunContext, incline: number | null): LiveTarget {
  const kmh = recoveryKmh(run)
  const pace = Math.round(3600 / kmh)
  const [value, unit] =
    run.environment === 'indoor'
      ? [(run.unit === 'kmh' ? kmh : speedFor(pace, run.unit)).toFixed(1), UNIT_LABEL[run.unit]]
      : [clock(pace), '/km']
  const figure = unit === '/km' ? `${value}/km` : `${value} ${unit}`
  return { value, unit, incline, pace, words: `Jog ~${figure}, or walk` }
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
  /** Blocks run to a distance, with the seconds they took; a HYROX round's is the whole round. */
  splits: { block: number; seconds: number }[]
  /** Each HYROX round leg finished, with its own seconds, in the order of `roundLegs`. */
  legs: { block: number; seconds: number }[]
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
    legs: [],
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
 * warm-up, drills, a checklist, Set up or the cooldown, which doesn't. On a Block run
 * to a distance or a Station, the tap that says it's covered, which records
 * its split. On a HYROX round, the tap that ends a leg: the round moves on
 * only after its last. Paused stays paused, on the next Block.
 */
export function nextBlock(run: LiveRun, now: number): LiveRun {
  const current = advance(run, now)
  const leg = currentLeg(current)
  if (leg === null) return finishBlock(current, now, current)
  // A second tap a moment after the first is a bounce, not a leg done.
  if (legElapsed(current, now) < LEG_BOUNCE_SECONDS) return current
  const block = current.block
  const last = leg === roundLegs(current.blocks[block]).length - 1
  // The last leg is what's left of the round's time, so the legs always add up to it.
  const before = legsDone(current, block).reduce((sum, s) => sum + s, 0)
  const seconds = last ? Math.round(blockElapsed(current, now)) - before : Math.round(legElapsed(current, now))
  const next = { ...current, legs: [...current.legs, { block, seconds: Math.max(0, seconds) }] }
  return last ? finishBlock(next, now, next) : next
}

/** Under this long, a leg's tap is the same thumb landing twice. */
const LEG_BOUNCE_SECONDS = 2

/** A HYROX round's legs, in order: its run, if it has one, then each Station. */
export function roundLegs(block: LiveBlock): StationPart[] {
  if (block.kind !== 'round') return []
  return [...(block.meters !== null ? (['run'] as const) : []), ...block.stations.map((s) => s.station)]
}

/** The seconds of each leg finished in a round. */
const legsDone = (run: LiveRun, block: number) => run.legs.filter((l) => l.block === block).map((l) => l.seconds)

/** The leg of the HYROX round the clock is on, from 0; null on any other Block. */
export function currentLeg(run: LiveRun): number | null {
  const block = run.blocks[run.block]
  if (!block || block.kind !== 'round') return null
  return Math.min(legsDone(run, run.block).length, roundLegs(block).length - 1)
}

/** Seconds on the current leg of a HYROX round, or on the whole Block anywhere else. */
export function legElapsed(run: LiveRun, now: number): number {
  const elapsed = blockElapsed(run, now)
  return currentLeg(run) === null ? elapsed : Math.max(0, elapsed - legsDone(run, run.block).reduce((sum, s) => sum + s, 0))
}

/** Ends the current Block on a tap; Skip block and Done can be undone back to `before`. */
function finishBlock(current: LiveRun, now: number, before: LiveRun): LiveRun {
  if (current.block >= current.blocks.length) return current
  const at = current.pausedAt ?? now
  const block = current.blocks[current.block]
  const seconds = Math.round(blockElapsed(current, now))
  if (block.seconds === null && !isChecklist(block) && block.kind !== 'setup') {
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
 * its stopwatch from its split, a round on its last leg; a timed one that ran its time starts again.
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
    // The round gone back to keeps every leg but its last, which runs on.
    legs: [...run.legs.filter((l) => before(l.block)), ...run.legs.filter((l) => l.block === block).slice(0, -1)],
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
 * A split put right on the finish sheet: a HYROX round's leg (from 0) or a
 * Race simulation's run or Station (`leg` null). Null seconds leaves it untimed.
 */
export interface SplitFix {
  block: number
  leg: number | null
  seconds: number | null
}

/**
 * The Station logs of the rounds and Stations finished: a HYROX round's
 * time, then its run and each Station with its own split; a Race
 * simulation's split on every run and Station. A round finished before legs
 * were timed logs only the round's time. `fixes` replace the splits they name.
 */
export function stationLogs(run: LiveRun, fixes: SplitFix[] = []): StationLog[] {
  const fixed = (block: number, leg: number | null, seconds: number | null) => {
    const fix = fixes.find((f) => f.block === block && f.leg === leg)
    const time = fix ? fix.seconds : seconds
    return time === null ? null : Math.min(SPLIT_MAX, time)
  }
  return run.blocks.flatMap((b, i): StationLog[] => {
    const split = run.splits.find((s) => s.block === i)
    if (b.round === null || !split) return []
    const round = b.round
    const runLog = (time: number | null): StationLog => ({ round, part: 'run', pounds: null, meters: b.meters, reps: null, seconds: time })
    const stationLog = (s: LiveStation, time: number | null): StationLog => ({
      round,
      part: s.station,
      pounds: s.pounds,
      meters: s.meters,
      reps: s.reps,
      seconds: time,
    })
    switch (b.kind) {
      case 'round': {
        const legs = legsDone(run, i)
        const timed = legs.length === roundLegs(b).length
        const leg = (n: number) => (timed ? fixed(i, n, legs[n]) : null)
        const ran = b.meters !== null ? 1 : 0
        return [
          { round, part: 'round', pounds: null, meters: null, reps: null, seconds: Math.min(SPLIT_MAX, split.seconds) },
          ...(ran ? [runLog(leg(0))] : []),
          ...b.stations.map((s, n) => stationLog(s, leg(n + ran))),
        ]
      }
      case 'distance':
        return [runLog(fixed(i, null, split.seconds))]
      default:
        return b.stations.map((s) => stationLog(s, fixed(i, null, split.seconds)))
    }
  })
}

/** A run or Station split too quick to be true: a tap that slipped. */
export interface QuickSplit extends SplitFix {
  seconds: number
  part: StationPart
  /** The round, or the place of a Race simulation's run and its Station. */
  round: number
  meters: number | null
  reps: number | null
  /** The quickest it could possibly have been. */
  fastest: number
}

/**
 * The seconds per metre (or per rep, on the wall balls) no one goes under,
 * well past the fastest in the world: a 2:00 km, a 1:15 500 m on the rower.
 */
const FASTEST: Record<StationPart, number> = {
  run: 0.12,
  round: 0,
  skierg: 0.15,
  row: 0.15,
  'sled-push': 0.4,
  'sled-pull': 0.4,
  'burpee-broad-jumps': 1,
  'farmers-carry': 0.25,
  'sandbag-lunges': 1,
  'wall-balls': 1,
}

/** The quickest a run or Station of this distance or rep count could possibly go. */
export function fastestSplit(part: StationPart, meters: number | null, reps: number | null): number {
  return Math.ceil(FASTEST[part] * (reps ?? meters ?? 0))
}

/** Every split of a HYROX round or a Race simulation faster than it could possibly have been: asked about before saving. */
export function quickSplits(run: LiveRun): QuickSplit[] {
  return run.blocks.flatMap((b, i): QuickSplit[] => {
    const split = run.splits.find((s) => s.block === i)
    if (b.round === null || !split) return []
    const lengths = new Map<StationPart, LiveStation>(b.stations.map((s) => [s.station, s]))
    const timed: { leg: number | null; part: StationPart; seconds: number }[] =
      b.kind === 'round'
        ? legsDone(run, i).map((seconds, leg) => ({ leg, part: roundLegs(b)[leg], seconds }))
        : [{ leg: null, part: b.kind === 'distance' ? 'run' : b.stations[0].station, seconds: split.seconds }]
    return timed.flatMap(({ leg, part, seconds }): QuickSplit[] => {
      const meters = part === 'run' ? b.meters : (lengths.get(part)?.meters ?? null)
      const reps = part === 'run' ? null : (lengths.get(part)?.reps ?? null)
      const fastest = fastestSplit(part, meters, reps)
      return seconds < fastest ? [{ block: i, leg, seconds, part, round: b.round!, meters, reps, fastest }] : []
    })
  })
}

/** Three hours: a split longer than that is a phone left running. */
const SPLIT_MAX = 3 * 3600

/** Seconds actually run: from Start to the end, pauses and Set up left out. */
export function activeSeconds(run: LiveRun, now: number): number {
  const endAt = run.finishedAt ?? run.pausedAt ?? now
  return Math.max(0, (endAt - run.startedAt - run.pausedMs) / 1000 - setUpSeconds(run, now))
}

/** Time spent on Set up: the Set up Blocks ended, and the current one if that's where the clock is. */
function setUpSeconds(run: LiveRun, now: number): number {
  const ended = run.cutShort.filter((c) => c.block !== run.block && run.blocks[c.block]?.kind === 'setup')
  const current = run.blocks[run.block]?.kind === 'setup' ? blockElapsed(run, now) : 0
  return ended.reduce((sum, c) => sum + c.seconds, 0) + current
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
  /** Splits too quick to be true, put right or left untimed on the finish sheet. */
  fixes?: SplitFix[]
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
export function predictedRpe(run: Pick<LiveRun, 'type' | 'blocks'>): number {
  const asked = run.blocks.filter((b) => b.work).flatMap((b) => (b.effort?.rpe ? [b.effort.rpe[1]] : []))
  return asked.length > 0 ? Math.max(...asked) : TYPICAL_RPE[run.type]
}

/** The same guess for a Session logged after, from the watch rather than Live. */
export const sessionRpe = (session: Session) => predictedRpe({ type: session.type, blocks: liveBlocks(session) })

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
    stations: stationLogs(run, input.fixes),
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
    // Runs stored before HYROX rounds were timed leg by leg have none.
    legs: Array.isArray(v.legs) ? v.legs : [],
    ready: v.ready === true,
    ticked: Array.isArray(v.ticked) ? v.ticked : [],
    undo: before ? { run: before, at: v.undo!.at } : null,
    markedDone: v.markedDone === true,
  } as LiveRun
}
