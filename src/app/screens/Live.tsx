import { useCallback, useEffect, useLayoutEffect, useRef, useState, type FormEvent } from 'react'
import {
  Button,
  Checkbox,
  FieldError,
  Form,
  Input,
  Label,
  Link,
  NumberField,
  Text,
  TextField,
} from 'react-aria-components'
import { motion } from 'motion/react'
import {
  advance,
  answer,
  answerStations,
  asksAfter,
  blockElapsed,
  blockLeft,
  canUndo,
  currentLeg,
  distanceSeconds,
  end,
  endRest,
  goBack,
  byFeelHint,
  byFeelPrefill,
  hasByFeelReps,
  heldUnanswered,
  isChecklist,
  isOver,
  legElapsed,
  liveStatus,
  liveTarget,
  markDone,
  nextBlock,
  pause,
  predictedRpe,
  quickSplits,
  redone,
  resume,
  roundLegs,
  shortBlocks,
  tick,
  undo,
  UNDO_MS,
  type LiveBlock,
  type LiveRun,
  type LiveStation,
  type LiveTarget,
  type QuickSplit,
  type SplitFix,
  type StationChange,
} from '../../domain/live'
import { nowMs } from '../../domain/clock'
import { isLifts, type LiveLifts, type LiveSession } from '../../domain/lifts'
import { PACE_SECONDS, STATION_METERS, STATION_POUNDS, STATION_REPS } from '../../domain/log'
import { clock, clockInput, KM_PER_MILE, parseClock, type RunContext } from '../../domain/paces'
import { poundsWords } from '../../domain/program/describe'
import { stations } from '../../domain/program/program'
import type { Lane } from '../../domain/program/types'
import type { StationPart } from '../../domain/log'
import type { WorkingWeightSuggestion } from '../../domain/suggestion'
import { dropIn, LanePresence, play, riseIn, useEntrances, wipeIn } from '../motion'
import { RestCountdown } from '../components/RestCountdown'
import { StripedNumeral } from '../components/StripedNumeral'
import { nb } from '../format'
import { blockChangeCue, keepAwake, letSleep, unlockSound } from '../liveCues'
import { finishLine, liveLine } from '../liveCopy'
import { navigate, SCREEN_PATH } from '../router'
import { validateTime } from './LogAfter'
import { Lifting, type LiftsFinish } from './LiveLifts'
import {
  DiscardButton,
  finishBarClass,
  groupLabel,
  inputClass,
  lineButton,
  linkButton,
  OverallRpe,
  primaryButton,
  quietButton,
} from './liveUi'

/** What the finish sheet hands back to be saved as the Session log. */
export interface LiveFinish {
  rpe: number
  distanceMeters: number | null
  resultSeconds: number | null
  /** Splits too quick to be true, put right or left untimed. */
  fixes: SplitFix[]
  /** By-feel speeds in seconds per km, each null when left blank. */
  hardPace: number | null
  recoveryPace: number | null
}

const LANE_BG: Record<Lane, string> = {
  speed: 'bg-speed',
  strength: 'bg-strength',
  threshold: 'bg-threshold',
  hyrox: 'bg-hyrox',
  easy: 'bg-easy',
}


/**
 * A Live session: sets at the rack (LiveLifts.tsx), or a run against the clock.
 *
 * A Live run session: the cobalt field with the Block, its target speed huge
 * and striped, and the time left; a lane per Block below, an earlier one a
 * tap to go back to; Pause and Skip block (or Done) pinned to the bottom
 * where a thumb finds them, and Start alone while the clock holds on Ready.
 *
 * The clock never re-renders the page. A tick writes the timer and the
 * current lane's fill straight into the DOM, and the run state only changes
 * (and React only renders) when something real happens: a new Block, a
 * pause, an answer. So a tap is never lost to a re-render.
 */
export function Live({
  live,
  runContext,
  onChange,
  onSave,
  onSaveLifts,
  onDecide,
}: {
  live: LiveSession | null
  /** Paces and units now; the Environment is the run's own. */
  runContext: RunContext
  onChange: (live: LiveSession | null) => void
  onSave: (run: LiveRun, finish: LiveFinish) => void
  onSaveLifts: (lifts: LiveLifts, finish: LiftsFinish) => void
  onDecide: (suggestion: WorkingWeightSuggestion, decision: 'accepted' | 'kept') => void
}) {
  if (!live) {
    return (
      <div className="px-pad pt-6 desktop:px-gutter desktop:pt-7">
        <h1 tabIndex={-1} className="text-headline">
          Nothing running.
        </h1>
        <p className="mt-2 text-prescription">Start a Session from Today.</p>
        <Link href={SCREEN_PATH.today} className={`mt-4 ${linkButton}`}>
          ← Today
        </Link>
      </div>
    )
  }
  if (isLifts(live)) return <Lifting lifts={live} onChange={onChange} onSave={onSaveLifts} onDecide={onDecide} />
  return <Running run={live} runContext={runContext} onChange={onChange} onSave={onSave} />
}

function Running({
  run,
  runContext,
  onChange,
  onSave,
}: {
  run: LiveRun
  runContext: RunContext
  onChange: (run: LiveRun | null) => void
  onSave: (run: LiveRun, finish: LiveFinish) => void
}) {
  const context: RunContext = { ...runContext, environment: run.environment }
  const entrances = useEntrances()
  const over = isOver(run)
  const paused = run.pausedAt !== null
  const block: LiveBlock | undefined = run.blocks[run.block]
  const leg = currentLeg(run)
  const target = block && targetFor(block, context, leg)
  const [backTo, setBackTo] = useState<number | null>(null)

  const runRef = useRef(run)
  runRef.current = run
  const timerRef = useRef<HTMLSpanElement>(null)
  const fillRef = useRef<HTMLElement>(null)
  const bandRef = useRef<HTMLElement>(null)
  const restRef = useRef<HTMLDivElement>(null)

  /** Writes the clock into the page without React: the timer's text and the current lane's fill. */
  const paint = useCallback((now: number) => {
    const current = runRef.current
    const left = blockLeft(current, now)
    const elapsed = blockElapsed(current, now)
    // A HYROX round's clock is its current leg's.
    if (timerRef.current) timerRef.current.textContent = timerText(left === null ? Math.floor(legElapsed(current, now)) : Math.ceil(left - 0.001))
    const seconds = current.blocks[current.block]?.seconds
    if (fillRef.current && seconds) fillRef.current.style.width = `${Math.min(100, (elapsed / seconds) * 100)}%`
  }, [])

  useLayoutEffect(() => paint(nowMs()))

  // One tick per second shown, on the timer's next whole second; none while paused.
  useEffect(() => {
    if (over || paused) return
    let timer = 0
    const tick = () => {
      const now = nowMs()
      const next = advance(runRef.current, now)
      if (next !== runRef.current) {
        // Ahead of the render, so nothing moves on from the same Block twice.
        runRef.current = next
        onChange(next)
        return
      }
      paint(now)
      const elapsedMs = now - next.blockStartedAt - next.blockPausedMs
      timer = window.setTimeout(tick, 1000 - (((elapsedMs % 1000) + 1000) % 1000))
    }
    tick()
    const visible = () => {
      if (document.visibilityState !== 'visible') return
      window.clearTimeout(timer)
      tick()
      void keepAwake()
    }
    document.addEventListener('visibilitychange', visible)
    return () => {
      window.clearTimeout(timer)
      document.removeEventListener('visibilitychange', visible)
    }
  }, [over, paused, run.block, onChange, paint])

  useEffect(() => {
    if (over || paused) letSleep()
    else void keepAwake()
  }, [over, paused])
  useEffect(() => letSleep, [])

  // A new Block opens on its target, however far the last one was scrolled.
  useLayoutEffect(() => {
    bandRef.current?.scrollTo(0, 0)
    restRef.current?.scrollTo(0, 0)
    window.scrollTo(0, 0)
  }, [run.block, run.ready])

  const shownBlock = useRef(run.block)
  useEffect(() => {
    if (shownBlock.current === run.block) return
    shownBlock.current = run.block
    blockChangeCue()
  }, [run.block])

  /** Every control goes through here: the tap also lets the phone make sound. */
  const act = (step: (run: LiveRun, now: number) => LiveRun) => {
    unlockSound()
    runRef.current = step(runRef.current, nowMs())
    onChange(runRef.current)
  }

  return (
    // On the clock the page is one screen that never scrolls: the band keeps the target and the clock at
    // the top, the Blocks scroll in what's left (or fold away to make room), and the actions stay docked.
    <div className={`flex flex-col ${over ? 'min-h-dvh' : 'h-dvh'}`}>
      {/* The field drops in from the top as the session opens, once. */}
      <motion.header
        ref={bandRef}
        {...play(dropIn, entrances)}
        className={`on-field bg-cobalt px-pad pt-[calc(14px+env(safe-area-inset-top))] pb-5 text-on-cobalt desktop:px-gutter desktop:pb-7 ${over ? '' : 'relative min-h-0 flex-[0_1_auto] overflow-y-auto'}`}
      >
        <div className="flex items-center justify-between gap-3">
          <h1 tabIndex={-1} className="text-[22px]">
            {nb(run.heading)}
          </h1>
          {!over && (
            <Button
              onPress={() => act(end)}
              className="min-h-11 cursor-pointer px-2 text-[17px] font-bold text-on-cobalt underline decoration-2 underline-offset-4 hover:decoration-[3px]"
            >
              End
            </Button>
          )}
        </div>

        {over || !block ? (
          <>
            <p className="mt-5 text-[20px] font-bold">{run.ending ? 'Ended early' : 'Session over'}</p>
            <p className="mt-2 text-[18px] font-semibold">{finishLine(liveStatus(run))}</p>
          </>
        ) : (
          <>
            {/* A new Block's name wipes in; its numbers below change at once, to be read mid-stride. */}
            <motion.p key={run.block} {...play(wipeIn, entrances)} className="mt-3.5 text-[20px] font-bold">
              {nb(run.ready ? readyWords(block, target) : `${block.name} · ${blockLength(block)}`)}
            </motion.p>
            {target ? (
              <p className="@container mt-1.5 flex flex-wrap items-baseline gap-x-2">
                <StripedNumeral value={target.value} className="text-numeral-live" />
                <span className="text-[24px] font-bold">{target.unit}</span>
                {target.secondary && (
                  <span className="basis-full text-[24px] font-bold">
                    {target.secondary.value}
                    {target.secondary.unit}
                  </span>
                )}
              </p>
            ) : (
              <p className="mt-2 text-headline">{nb(feelWords(block, context))}</p>
            )}
            <div className="mt-3.5 flex items-end justify-between gap-4">
              <span>
                {target?.incline !== null && target?.incline !== undefined && (
                  <>
                    <b className="block text-[56px] leading-[0.9] font-black tracking-[-0.03em] font-stretch-125%">
                      {target.incline}%
                    </b>
                    <span className="text-[15px] font-semibold">incline</span>
                  </>
                )}
              </span>
              <span
                ref={timerRef}
                role="timer"
                aria-label={
                  leg !== null
                    ? `Time on the ${legName(roundLegs(block)[leg])}`
                    : block.seconds === null
                      ? `Time on the ${block.name}`
                      : `Time left in ${block.name}`
                }
                className="text-figure font-stretch-125%"
              />
            </div>
            {leg !== null ? (
              <RoundLegs block={block} leg={leg} done={run.legs.filter((l) => l.block === run.block).map((l) => l.seconds)} />
            ) : (
              block.stations.length > 0 && <StationList block={block} />
            )}
            {isChecklist(block) ? (
              <Checklist block={block} ticked={run.ticked} onTick={(row) => act((r, now) => tick(r, row, now))} />
            ) : block.detail.length > 0 && (
              <ul className="mt-3 text-body">
                {block.detail.map((d) => (
                  <li key={d}>{nb(d)}</li>
                ))}
              </ul>
            )}
            <p aria-live="polite" className="mt-3.5 min-h-6 text-[18px] font-semibold">
              {run.ready ? 'The clock waits. Tap Start when you’re set.' : liveLine(block, run)}
            </p>
          </>
        )}
      </motion.header>

      {/* On the finish sheet its actions sit on the screen's bottom edge, so no padding under them. */}
      {/* A question about the Block just finished keeps room for itself; the Blocks alone can fold to nothing. */}
      <div
        ref={restRef}
        className={`flex flex-1 flex-col px-pad desktop:max-w-plan desktop:px-gutter ${over ? 'desktop:pb-6' : 'relative min-h-0 basis-0 overflow-y-auto pb-6 has-[section]:min-h-28'}`}
      >
        <HeldCheck
          run={run}
          context={context}
          onAnswer={(b, pace, actual) => act((r) => answer(r, b, pace, actual))}
          onStations={(b, change) => act((r) => answerStations(r, b, change))}
        />
        {over ? (
          <FinishSheet
            run={run}
            context={context}
            onKeepGoing={() => act(resume)}
            onMarkDone={(done) => act((r) => markDone(r, done))}
            onSave={(f) => onSave(heldUnanswered(run, context), f)}
            onDiscard={() => {
              onChange(null)
              navigate(SCREEN_PATH.today)
            }}
          />
        ) : (
          <>
            {backTo !== null && backTo < run.block && (
              <GoBackCheck
                run={run}
                block={backTo}
                onBack={() => {
                  setBackTo(null)
                  act((r, now) => goBack(r, backTo, now))
                }}
                onCancel={() => setBackTo(null)}
              />
            )}
            <Lanes
              run={run}
              context={context}
              fillRef={fillRef}
              onBack={(b) => (redone(run, b).length > 0 ? setBackTo(b) : act((r, now) => goBack(r, b, now)))}
            />
          </>
        )}
      </div>

      {/* Between a checklist's sets: the rest, as Live lifts has it, over the bar. Ticking the next set ends it. */}
      <LanePresence popLayout>
        {!over && run.rest && (
          <motion.div
            key={`rest-${run.block}-${run.rest.row}-${run.rest.startedAt}`}
            {...play(riseIn, entrances)}
            className="flex-none bg-cobalt px-pad py-2 text-on-cobalt desktop:px-gutter"
          >
            <RestCountdown
              startedAt={run.rest.startedAt}
              seconds={run.rest.seconds}
              onOver={() => act(endRest)}
              onSkip={() => act(endRest)}
            />
          </motion.div>
        )}
      </LanePresence>

      {!over && block && (
        <div className="flex-none border-t-2 border-ink bg-paper px-pad pt-3 pb-[calc(12px+env(safe-area-inset-bottom))] desktop:px-gutter">
          <UndoToast run={run} onUndo={() => act(undo)} />
          <div className="flex gap-2.5">
            {run.ready ? (
              <Button onPress={() => act(resume)} className={`${primaryButton} desktop:max-w-60`}>
                Start
              </Button>
            ) : (
              <>
                <Button onPress={() => act(paused ? resume : pause)} className={`${leg !== null && !paused ? lineButton : primaryButton} desktop:max-w-60`}>
                  {paused ? 'Resume' : 'Pause'}
                </Button>
                {/* In a round the leg's tap is the one that matters, made from a few steps away: the big, filled one. */}
                <Button
                  onPress={() => act(nextBlock)}
                  className={leg !== null && !paused ? `${primaryButton} min-h-18 flex-[2] desktop:max-w-90` : `${lineButton} desktop:max-w-60`}
                >
                  {finishedLabel(block, leg)}
                </Button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

/**
 * The hero target: the exact speed or pace, the RPE before there are paces,
 * the distance of a 5 km or a run, or a Station's volume. On a HYROX round,
 * its current leg's: the run, then each Station.
 */
function targetFor(block: LiveBlock, context: RunContext, leg: number | null): LiveTarget | null {
  const plain = (value: string, unit: string, words: string): LiveTarget => ({
    value,
    unit,
    secondary: null,
    incline: null,
    pace: null,
    figure: `${value} ${unit}`,
    words,
  })
  const part = leg === null ? null : roundLegs(block)[leg]
  const station = block.kind === 'station' ? block.stations[0] : block.stations.find((s) => s.station === part)
  if ((block.kind === 'distance' || part === 'run') && block.meters) {
    const unit = part === 'run' ? ' run' : ''
    return block.meters % 1000 === 0
      ? plain(String(block.meters / 1000), `km${unit}`, km(block.meters))
      : plain(String(block.meters), `m${unit}`, km(block.meters))
  }
  if (station) {
    // A round's Station says which, beside its number: "500 m SkiErg".
    const name = part === null ? '' : ` ${stations[station.station].name}`
    if (station.reps) return plain(String(station.reps), `reps${name}`, volume(station))
    // Four digits don't fit a phone: 1000 m reads as 1 km, like the runs.
    const meters = station.meters ?? 0
    return meters % 1000 === 0
      ? plain(String(meters / 1000), `km${name}`, volume(station))
      : plain(String(meters), `m${name}`, volume(station))
  }
  return liveTarget(block, context)
}

/**
 * The tap that ends a Block early: Skip block on timed work, which makes the
 * log Partial; Done on anything else. Finished on a Block run to a distance or to the end of its work,
 * and on each leg of a HYROX round.
 */
function finishedLabel(block: LiveBlock, leg: number | null): string {
  if (!block.work && (block.seconds !== null || isChecklist(block) || block.kind === 'setup')) return 'Done'
  if (block.seconds !== null) return 'Skip block'
  if (leg !== null) {
    const part = roundLegs(block)[leg]
    return `Finished ${part === 'run' ? km(block.meters ?? 0) : legName(part)}`
  }
  if (block.kind === 'station') return `Finished ${block.name}`
  return `Finished ${km(block.meters ?? 0)}`
}

/** "Run", "Sled push" */
const legName = (part: StationPart) => (part === 'run' || part === 'round' ? 'Run' : stations[part].name)

/** A Station's distance or reps: "25 m", "20 reps". Nothing on Set up, where only the load matters. */
const volume = (leg: LiveStation) => (leg.reps ? `${leg.reps} reps` : leg.meters ? km(leg.meters) : '')

/** "25 m · 200 lb plates", "20 reps · 13 lb ball", "250 m" */
const stationWords = (leg: LiveStation) =>
  [volume(leg), poundsWords(stations[leg.station], leg.pounds)].filter(Boolean).join(' · ')

/**
 * A round's Stations, large enough to read from the floor; a Race
 * simulation Station's load; every Station to load on Set up. Sled loads are the plates to add.
 */
function StationList({ block }: { block: LiveBlock }) {
  if (block.kind === 'station') {
    const load = poundsWords(stations[block.stations[0].station], block.stations[0].pounds)
    return load ? <p className="mt-2 text-[22px] font-bold">{nb(load)}</p> : null
  }
  return (
    <ul aria-label="Stations" className="mt-3 grid gap-1">
      {block.stations.map((leg) => (
        <li key={leg.station} className="text-[22px] leading-tight font-bold">
          {stations[leg.station].name}{' '}
          <span className="block text-[17px] font-semibold">{nb(stationWords(leg))}</span>
        </li>
      ))}
    </ul>
  )
}

/**
 * A HYROX round's legs, one row each, read from the floor: those done struck
 * through with their split, the load of the one on the clock (the hero names
 * it), then what's left to get ready for.
 */
function RoundLegs({ block, leg, done }: { block: LiveBlock; leg: number; done: number[] }) {
  return (
    <ol aria-label="Legs" className="mt-3 grid gap-1.5">
      {roundLegs(block).map((part, i) => {
        const station = block.stations.find((s) => s.station === part)
        const words = station ? stationWords(station) : km(block.meters ?? 0)
        if (i === leg) {
          // The hero says what and how far: the load is all that's left to say.
          const load = station && poundsWords(stations[station.station], station.pounds)
          return (
            <li key={part} aria-current="step" className={load ? 'text-[22px] leading-tight font-bold' : 'sr-only'}>
              <span className="sr-only">{legName(part)}, now{load ? ': ' : ''}</span>
              {load && nb(load)}
            </li>
          )
        }
        const split = done[i]
        return (
          <li key={part} className="flex items-baseline justify-between gap-3 text-[17px] font-semibold">
            <span className={split !== undefined ? 'line-through decoration-2' : undefined}>
              {nb(`${legName(part)} · ${words}`)}
            </span>
            {split !== undefined && (
              <span className="flex-none">
                <span className="sr-only">, done in </span>
                {clock(split)}
              </span>
            )}
          </li>
        )
      })}
    </ol>
  )
}

/** Where there's nothing to dial: what the Block is about instead, and a by-feel rep's speed last time. */
function feelWords(block: LiveBlock, context: RunContext): string {
  if (block.effort && 'feel' in block.effort) {
    const feel = { easy: 'Easy', hard: 'Hard, by feel', controlled: 'Controlled', relaxed: 'Relaxed', 'all-out': 'All-out' }[
      block.effort.feel
    ]
    const hint = byFeelHint(block, context)
    return hint ? `${feel} · ${hint}` : feel
  }
  if (block.effort) return 'Easy'
  if (block.kind === 'setup') return 'Not training time'
  return block.kind === 'drills' ? 'Drills' : 'Walk'
}

/** "12 min", "90 s", "5 km", "600 m + 2 Stations", "50 m", "4 Stations" */
function blockLength(block: LiveBlock): string {
  if (block.kind === 'round') {
    const n = block.stations.length
    return `${km(block.meters ?? 0)} + ${n} ${n === 1 ? 'Station' : 'Stations'}`
  }
  if (block.kind === 'setup') return `${block.stations.length} ${block.stations.length === 1 ? 'Station' : 'Stations'}`
  if (block.kind === 'station') return volume(block.stations[0])
  if (isChecklist(block)) return `${block.checklist.length} sets`
  if (block.seconds === null) return km(block.meters ?? 0)
  return block.seconds % 60 === 0 ? `${block.seconds / 60} min` : `${block.seconds} s`
}

/** "Ready? Up next: Rep 1 of 5 · 15.1 km/h · 3:58/km · 1% incline", "Ready? Up next: 5 km" */
function readyWords(block: LiveBlock, target: LiveTarget | null): string {
  const what = target ? target.figure : blockLength(block)
  return `Ready? Up next: ${what === block.name ? block.name : `${block.name} · ${what}`}`
}

/** The hero figure alone, in the unit the athlete answers in: "12.3 km/h", "4:52/km" */
function heroShort({ value, unit }: LiveTarget): string {
  return unit === '/km' ? `${value}/km` : `${value} ${unit}`
}

const km = (meters: number) => (meters % 1000 === 0 ? `${meters / 1000} km` : `${meters} m`)

/** 300 → "05:00", 4000 → "66:40" */
const timerText = (seconds: number) => clock(seconds).padStart(5, '0')

/**
 * A checklist Block's sets, each a tap to tick, big enough to hit between
 * jumps. The last tick ends the Block. Never logged.
 */
function Checklist({ block, ticked, onTick }: { block: LiveBlock; ticked: number[]; onTick: (row: number) => void }) {
  return (
    <ul aria-label="Sets" className="mt-3 grid gap-1">
      {block.checklist.map((row, i) => (
        <li key={row}>
          <Checkbox
            isSelected={ticked.includes(i)}
            onChange={() => onTick(i)}
            className="group flex min-h-11 cursor-pointer items-center gap-3 text-[19px] font-bold data-focus-visible:outline-3 data-focus-visible:outline-offset-2 data-focus-visible:outline-current data-selected:line-through"
          >
            <span
              aria-hidden="true"
              className="grid size-7 flex-none place-items-center rounded-sm shadow-[inset_0_0_0_2px_currentColor] group-data-selected:bg-current"
            >
              <svg viewBox="0 0 16 16" className="hidden size-4 text-cobalt group-data-selected:block">
                <path d="M3 8.5 6.5 12 13 4.5" fill="none" stroke="currentColor" strokeWidth="2.5" />
              </svg>
            </span>
            {nb(row)}
          </Checkbox>
        </li>
      ))}
    </ul>
  )
}

/**
 * For a few seconds after Skip block or Done: the Block back, as it was, its
 * clock still running. Gone on its own; the run keeps the snapshot until the next tap.
 */
function UndoToast({ run, onUndo }: { run: LiveRun; onUndo: () => void }) {
  const entrances = useEntrances()
  const at = run.undo?.at ?? null
  const [expired, setExpired] = useState<number | null>(null)
  useEffect(() => {
    if (at === null) return
    const timer = window.setTimeout(() => setExpired(at), Math.max(0, UNDO_MS - (nowMs() - at)))
    return () => window.clearTimeout(timer)
  }, [at])
  const shown = run.undo && expired !== at && canUndo(run, nowMs()) ? run.undo : null
  const left = shown?.run.blocks[shown.run.block]
  return (
    <LanePresence>
      {shown && left && (
        <motion.div key={shown.at} {...play(riseIn, entrances)} role="status" className="mb-3 flex items-center justify-between gap-3">
          <p className="text-body font-semibold">{nb(`${left.name}: ${left.work ? 'skipped' : 'done'}.`)}</p>
          <Button onPress={onUndo} className={linkButton}>
            Undo
          </Button>
        </motion.div>
      )}
    </LanePresence>
  )
}

/** "Rep 2", "Reps 2–4", "Round 2 to Cooldown": the Blocks going back will run again. */
function redoneWords(run: LiveRun, from: number): string {
  const to = Math.min(run.block, run.blocks.length - 1)
  const range = run.blocks.slice(from, to + 1)
  const reps = range.filter((b) => b.work).map((b) => b.rep)
  if (reps.length > 0 && reps.every((r) => r !== null)) {
    return reps.length === 1 ? `Rep ${reps[0]}` : `Reps ${reps[0]}–${reps.at(-1)}`
  }
  return from === to ? range[0].name : `${range[0].name} to ${range.at(-1)!.name}`
}

/** Asks before going back drops what was recorded since. */
function GoBackCheck({
  run,
  block,
  onBack,
  onCancel,
}: {
  run: LiveRun
  block: number
  onBack: () => void
  onCancel: () => void
}) {
  const name = run.blocks[block].name
  return (
    <section aria-label={`Go back to ${name}?`} className="mt-4 border-t-2 border-ink pt-3 pb-1">
      <p className="text-body">{nb(`Go back to ${name}? ${redoneWords(run, block)} will be redone.`)}</p>
      <div className="mt-1 flex gap-5">
        <Button onPress={onBack} className={linkButton}>
          Go back
        </Button>
        <Button onPress={onCancel} className={quietButton}>
          Cancel
        </Button>
      </div>
    </section>
  )
}

function Lanes({
  run,
  context,
  fillRef,
  onBack,
}: {
  run: LiveRun
  context: RunContext
  fillRef: React.RefObject<HTMLElement | null>
  /** An earlier Block tapped: back to it. */
  onBack: (block: number) => void
}) {
  return (
    <ol aria-label="Blocks" className="mt-5 grid gap-3">
      {run.blocks.map((b, i) => {
        const current = i === run.block
        const target = b.kind === 'rep' ? liveTarget(b, context) : null
        const split = b.round !== null ? run.splits.find((s) => s.block === i) : undefined
        return (
          <li
            key={i}
            aria-current={current ? 'step' : undefined}
            className={`grid grid-cols-[1fr_auto] gap-x-2.5 gap-y-1.5 ${current ? 'text-[17px] font-extrabold' : 'text-[15px] font-semibold'}`}
          >
            {i < run.block ? (
              <Button
                onPress={() => onBack(i)}
                aria-label={`${b.name}${run.skipped.includes(i) ? ', skipped' : ', done'}`}
                className="cursor-pointer justify-self-start text-left hover:underline hover:decoration-2 hover:underline-offset-4 data-focus-visible:outline-3 data-focus-visible:outline-offset-2 data-focus-visible:outline-link"
              >
                {b.name}
                <span className="sr-only">{run.skipped.includes(i) ? ', skipped' : ', done'}</span>
              </Button>
            ) : (
              <span>{b.name}</span>
            )}
            <span className="text-muted">
              {target ? target.figure : blockLength(b)}
              {split && ` · ${clock(split.seconds)}`}
            </span>
            <span aria-hidden="true" className={`relative col-span-full block overflow-hidden bg-rule transition-[height] duration-(--dur-enter) ${current ? 'h-[26px]' : 'h-3'}`}>
              <i
                ref={current ? fillRef : undefined}
                className={`lane-fill absolute inset-y-0 left-0 ${LANE_BG[b.lane]}`}
                // A round's lane fills a share for each leg done; a timed Block's is painted by the clock.
                style={{ width: i < run.block ? '100%' : current ? roundFill(run, b, i) : '0%' }}
              />
            </span>
          </li>
        )
      })}
    </ol>
  )
}

/** How much of a HYROX round's lane is filled: a share per leg done. Undefined for any other Block. */
function roundFill(run: LiveRun, block: LiveBlock, i: number): string | undefined {
  const legs = roundLegs(block).length
  if (legs === 0) return undefined
  return `${(run.legs.filter((l) => l.block === i).length / legs) * 100}%`
}

/**
 * After a rep at a target: Held it, or Changed with what was run instead.
 * Saying nothing is Held it, so the tap is only for a rep that wasn't. A
 * by-feel rep asks nothing: its speed is asked once, on the finish sheet.
 */
function HeldCheck({
  run,
  context,
  onAnswer,
  onStations,
}: {
  run: LiveRun
  context: RunContext
  onAnswer: (block: number, targetPace: number | null, actualPace: number | null) => void
  onStations: (block: number, change: StationChange | null) => void
}) {
  const [changing, setChanging] = useState<number | null>(null)
  const [speed, setSpeed] = useState(Number.NaN)
  const [pace, setPace] = useState('')
  // Only the Block just finished asks: one left alone was held (or as written), and saves that way.
  let latest = Math.min(run.block, run.blocks.length) - 1
  while (latest >= 0 && !asksAfter(run.blocks[latest])) latest -= 1
  if (latest < 0 || !run.asks.includes(latest)) return null
  const asked = latest

  const block = run.blocks[asked]
  if (block.kind === 'round' || block.kind === 'station') {
    return <StationCheck key={asked} block={block} onAnswer={(change) => onStations(asked, change)} />
  }
  const target = liveTarget(block, context)
  const indoor = run.environment === 'indoor'
  const unit = context.unit === 'kmh' ? 'km/h' : 'mph'
  const question = target?.pace ? `held ${heroShort(target)}?` : 'done as written?'

  function submit(event: FormEvent) {
    event.preventDefault()
    const actual = indoor ? paceFromSpeed(speed, context.unit) : parseClock(pace)
    if (actual === null || actual < PACE_SECONDS[0] || actual > PACE_SECONDS[1]) return
    setChanging(null)
    setSpeed(Number.NaN)
    setPace('')
    onAnswer(asked, target?.pace ?? null, actual)
  }

  return (
    <section aria-label={`${block.name}: held the target?`} className="mt-4 border-t-2 border-ink pt-3 pb-1">
      <p className="text-body">
        {block.name}: {question}
      </p>
      <p className="text-body-quiet text-muted">Say nothing and it logs as held.</p>
      {changing === asked ? (
        <Form onSubmit={submit} className="mt-2 flex flex-wrap items-end gap-3">
          {indoor ? (
            <NumberField
              value={speed}
              onChange={setSpeed}
              minValue={1}
              maxValue={30}
              step={0.1}
              isRequired
              autoFocus
              formatOptions={{ minimumFractionDigits: 1, maximumFractionDigits: 1 }}
              className="grid gap-2"
            >
              <Label className={groupLabel}>Actual speed, {unit}</Label>
              <Input className={inputClass} />
            </NumberField>
          ) : (
            <TextField
              value={pace}
              onChange={(text) => setPace(clockInput(text))}
              isRequired
              autoFocus
              inputMode="numeric"
              validate={(text) => (paceOk(parseClock(text)) ? null : 'A pace like 4:52.')}
              className="grid gap-2"
            >
              <Label className={groupLabel}>Actual pace, per km</Label>
              <Input placeholder="m:ss" autoComplete="off" className={inputClass} />
              <FieldError className="text-body-quiet font-bold text-ink" />
            </TextField>
          )}
          <Button type="submit" className={`${lineButton} flex-none`}>
            Save
          </Button>
        </Form>
      ) : (
        <div className="mt-1 flex gap-5">
          <Button onPress={() => onAnswer(asked, target?.pace ?? null, null)} className={linkButton}>
            Held it
          </Button>
          <Button onPress={() => setChanging(asked)} className={quietButton}>
            Changed
          </Button>
        </div>
      )}
    </section>
  )
}

/**
 * After a HYROX round or a Race simulation Station: As written, one tap, or
 * Changed with the load and distance actually done. Left alone, it logs as written.
 */
function StationCheck({ block, onAnswer }: { block: LiveBlock; onAnswer: (change: StationChange | null) => void }) {
  const [changing, setChanging] = useState(false)
  const [runMeters, setRunMeters] = useState(block.meters ?? Number.NaN)
  const [legs, setLegs] = useState(block.stations)
  const round = block.kind === 'round'
  const set = (i: number, field: 'pounds' | 'meters' | 'reps', value: number) =>
    setLegs((all) => all.map((leg, j) => (j === i ? { ...leg, [field]: Number.isFinite(value) ? Math.round(value) : leg[field] } : leg)))

  function submit(event: FormEvent) {
    event.preventDefault()
    onAnswer({ runMeters: round && Number.isFinite(runMeters) ? Math.round(runMeters) : undefined, stations: legs })
  }

  return (
    <section aria-label={`${block.name}: as written?`} className="mt-4 border-t-2 border-ink pt-3 pb-1">
      <p className="text-body">
        {block.name}: {nb(round ? `${blockLength(block)}, as written?` : `${stationWords(block.stations[0])}, as written?`)}
      </p>
      {changing ? (
        <Form onSubmit={submit} className="mt-2 grid gap-4">
          {round && (
            <AmountField label="Run, m" value={runMeters} onChange={setRunMeters} range={STATION_METERS} step={1} autoFocus />
          )}
          {legs.map((leg, i) => {
            const name = stations[leg.station].name
            return (
              <fieldset key={leg.station} className="flex flex-wrap gap-3">
                <legend className="sr-only">{name}</legend>
                {leg.reps !== null ? (
                  <AmountField label={`${name}, reps`} value={leg.reps} onChange={(v) => set(i, 'reps', v)} range={STATION_REPS} step={1} autoFocus={!round && i === 0} />
                ) : (
                  <AmountField label={`${name}, m`} value={leg.meters ?? Number.NaN} onChange={(v) => set(i, 'meters', v)} range={STATION_METERS} step={1} autoFocus={!round && i === 0} />
                )}
                {leg.pounds !== null && (
                  <AmountField label={`${name}, lb`} value={leg.pounds} onChange={(v) => set(i, 'pounds', v)} range={STATION_POUNDS} step={5} />
                )}
              </fieldset>
            )
          })}
          <Button type="submit" className={`${lineButton} justify-self-start flex-none`}>
            Save
          </Button>
        </Form>
      ) : (
        <div className="mt-1 flex gap-5">
          <Button onPress={() => onAnswer(null)} className={linkButton}>
            As written
          </Button>
          <Button onPress={() => setChanging(true)} className={quietButton}>
            Changed
          </Button>
        </div>
      )}
    </section>
  )
}

/**
 * What made the log Partial, Block by Block: "Rep 3: 2:50 of 3:00". If none
 * of it mattered, one tap logs it as Done.
 */
function CutShort({ run, onMarkDone }: { run: LiveRun; onMarkDone: (done: boolean) => void }) {
  const short = shortBlocks(run)
  if (short.length === 0) return null
  const words = ({ block, seconds }: { block: number; seconds: number | null }) => {
    const b = run.blocks[block]
    if (seconds === null) return `${b.name}: not run`
    return b.seconds === null ? `${b.name}: ${clock(seconds)}, not finished` : `${b.name}: ${clock(seconds)} of ${clock(b.seconds)}`
  }
  return (
    <section aria-label="Cut short" className="grid gap-2">
      <h2 className={groupLabel}>Cut short</h2>
      <ul className="text-body">
        {short.map((s) => (
          <li key={s.block}>{nb(words(s))}</li>
        ))}
      </ul>
      {run.markedDone ? (
        <Button onPress={() => onMarkDone(false)} className={`justify-self-start ${quietButton}`}>
          Log it as Partial after all
        </Button>
      ) : (
        <Button onPress={() => onMarkDone(true)} className={`justify-self-start ${linkButton}`}>
          Close enough: log it as Done
        </Button>
      )}
    </section>
  )
}

function AmountField({
  label,
  value,
  onChange,
  range,
  step,
  autoFocus = false,
}: {
  label: string
  value: number
  onChange: (value: number) => void
  range: readonly [number, number]
  step: number
  autoFocus?: boolean
}) {
  return (
    <NumberField
      value={value}
      onChange={onChange}
      minValue={range[0]}
      maxValue={range[1]}
      step={step}
      isRequired
      autoFocus={autoFocus}
      formatOptions={{ maximumFractionDigits: 0, useGrouping: false }}
      className="grid gap-2"
    >
      <Label className={groupLabel}>{label}</Label>
      <Input inputMode="numeric" className={inputClass} />
    </NumberField>
  )
}

const splitKey = ({ block, leg }: SplitFix) => `${block}-${leg ?? ''}`

/** "800 m", "50 reps" */
const splitAmount = (q: QuickSplit) => (q.reps !== null ? `${q.reps} reps` : km(q.meters ?? 0))

/** "Run, round 1 · 800 m", "SkiErg · 1 km" */
function splitName(run: LiveRun, q: QuickSplit): string {
  const block = run.blocks[q.block]
  return `${block.kind === 'round' ? `${legName(q.part)}, round ${q.round}` : block.name} · ${splitAmount(q)}`
}

/** Empty leaves it untimed; anything else has to be a time someone could have done. */
function validateSplit(q: QuickSplit, text: string): string | null {
  if (text.trim() === '') return null
  const seconds = parseClock(text)
  if (seconds === null) return 'A time like 3:30, or nothing.'
  return seconds < q.fastest ? `${clock(seconds)} can’t be right. Put the real time, or clear it to leave it untimed.` : null
}

const paceOk = (pace: number | null) => pace !== null && pace >= PACE_SECONDS[0] && pace <= PACE_SECONDS[1]

/** A treadmill speed in the chosen unit to seconds per km. */
function paceFromSpeed(speed: number, unit: RunContext['unit']): number | null {
  if (!Number.isFinite(speed) || speed <= 0) return null
  return Math.round(3600 / (unit === 'kmh' ? speed : speed * KM_PER_MILE))
}

/**
 * The end: a 5K test's time, the console distance indoors, and an overall
 * RPE for every Session. Ended early, Keep going goes back to the clock.
 */
function FinishSheet({
  run,
  context,
  onKeepGoing,
  onMarkDone,
  onSave,
  onDiscard,
}: {
  run: LiveRun
  context: RunContext
  onKeepGoing: () => void
  /** Partial flipped to Done, or back. */
  onMarkDone: (done: boolean) => void
  onSave: (finish: LiveFinish) => void
  onDiscard: () => void
}) {
  const status = liveStatus(run)
  const covered = distanceSeconds(run)
  const result = run.type === '5k-test' && status === 'done'
  // A circuit's runs are logged round by round, not as a console total.
  const indoor = run.environment === 'indoor' && run.type !== 'hyrox' && run.type !== 'race-simulation'
  const mile = context.unit === 'mph'
  const [time, setTime] = useState(covered === null ? '' : clock(covered))
  const [distance, setDistance] = useState(Number.NaN)
  const [predicted] = useState(() => predictedRpe(run))
  const [rpe, setRpe] = useState<number | null>(predicted)
  const [missingRpe, setMissingRpe] = useState(false)
  const quick = quickSplits(run)
  const [fixes, setFixes] = useState<Record<string, string>>({})
  const [speeds, setSpeeds] = useState<ByFeelAnswer>(() => byFeelPrefill(run, context))
  const fixText = (q: QuickSplit) => fixes[splitKey(q)] ?? clock(q.seconds)

  function submit(event: FormEvent) {
    event.preventDefault()
    if (rpe === null) {
      setMissingRpe(true)
      return
    }
    const resultSeconds = result ? parseClock(time) : null
    if (result && (resultSeconds === null || validateTime(time))) return
    if (quick.some((q) => validateSplit(q, fixText(q)))) return
    const meters = indoor && Number.isFinite(distance) ? Math.round(distance * (mile ? KM_PER_MILE * 1000 : 1000)) : null
    const fixed = quick.map(({ block, leg }, i) => ({ block, leg, seconds: parseClock(fixText(quick[i])) }))
    const hardPace = speedPace(speeds.hard, run.environment, context.unit)
    const recoveryPace = speedPace(speeds.jog, run.environment, context.unit)
    if (hardPace === undefined || recoveryPace === undefined) return
    onSave({ rpe, distanceMeters: meters, resultSeconds, fixes: fixed, hardPace, recoveryPace })
  }

  return (
    <Form onSubmit={submit} className="mt-4 flex flex-1 flex-col gap-6 border-t-2 border-ink pt-4">
      {quick.length > 0 && (
        <section aria-label="Too quick to be right" className="grid gap-4">
          <h2 className={groupLabel}>Too quick to be right</h2>
          {quick.map((q) => (
            <TextField
              key={splitKey(q)}
              value={fixText(q)}
              onChange={(text) => setFixes((all) => ({ ...all, [splitKey(q)]: clockInput(text) }))}
              validate={(text) => validateSplit(q, text)}
              inputMode="numeric"
              className="grid gap-2"
            >
              {({ isInvalid }) => (
                <>
                  <Label className="text-body">{nb(splitName(run, q))}</Label>
                  <Input placeholder="m:ss" autoComplete="off" className={inputClass} />
                  {isInvalid ? (
                    <FieldError className="text-body-quiet font-bold text-ink" />
                  ) : (
                    <Text slot="description" className="text-body-quiet text-muted">
                      {nb(`${clock(q.seconds)} for ${splitAmount(q)} is a slipped thumb, not a split. Put the real time, or clear it to leave it untimed.`)}
                    </Text>
                  )}
                </>
              )}
            </TextField>
          ))}
        </section>
      )}
      <CutShort run={run} onMarkDone={onMarkDone} />
      {hasByFeelReps(run) && <ByFeelSpeeds run={run} context={context} value={speeds} onChange={setSpeeds} />}
      {result && (
        <TextField
          value={time}
          onChange={(text) => setTime(clockInput(text))}
          isRequired
          validate={validateTime}
          inputMode="numeric"
          className="grid gap-2"
        >
          {({ isInvalid }) => (
            <>
              <Label className={groupLabel}>5 km time</Label>
              <Input placeholder="mm:ss" autoComplete="off" className={inputClass} />
              {isInvalid ? (
                <FieldError className="text-body-quiet font-bold text-ink" />
              ) : (
                <Text slot="description" className="text-body-quiet text-muted">
                  From Start to the Finished tap. Fix it if you tapped late. It sets the Training paces.
                </Text>
              )}
            </>
          )}
        </TextField>
      )}

      {indoor && (
        <NumberField
          value={distance}
          onChange={setDistance}
          minValue={0.1}
          maxValue={100}
          step={0.01}
          formatOptions={{ maximumFractionDigits: 2 }}
          className="grid gap-2"
        >
          <Label className={groupLabel}>Console distance, {mile ? 'mi' : 'km'}</Label>
          <Input inputMode="decimal" className={inputClass} />
          <Text slot="description" className="text-body-quiet text-muted">
            What the treadmill says. The watch guesses indoors.
          </Text>
        </NumberField>
      )}

      <OverallRpe
        value={rpe}
        missing={missingRpe}
        predicted={predicted}
        onChange={(v) => {
          setRpe(v)
          setMissingRpe(false)
        }}
      />

      <DiscardButton onDiscard={onDiscard} />
      <div className={finishBarClass}>
        <Button type="submit" className={`${primaryButton} desktop:flex-none`}>
          Save log
        </Button>
        {run.ending && (
          <Button onPress={onKeepGoing} className={`${lineButton} desktop:flex-none`}>
            Keep going
          </Button>
        )}
      </div>
    </Form>
  )
}

/** The By-feel speeds as typed: a speed indoors, a pace per km outdoors. Blank is no answer. */
interface ByFeelAnswer {
  hard: string
  jog: string
}

/**
 * A By-feel speed typed in to seconds per km: null when blank, undefined when
 * it can't be a pace, so the sheet holds until it's put right.
 */
function speedPace(text: string, environment: LiveRun['environment'], unit: RunContext['unit']): number | null | undefined {
  if (text.trim() === '') return null
  const pace = environment === 'indoor' ? paceFromSpeed(Number(text.replace(',', '.')), unit) : parseClock(text)
  return paceOk(pace) ? pace : undefined
}

/**
 * After a run with by-feel reps: what the hard reps and the jogs were, asked
 * once now that typing is possible. Both optional; never a Training pace.
 */
function ByFeelSpeeds({
  run,
  context,
  value,
  onChange,
}: {
  run: LiveRun
  context: RunContext
  value: ByFeelAnswer
  onChange: (value: ByFeelAnswer) => void
}) {
  const indoor = run.environment === 'indoor'
  const unit = indoor ? (context.unit === 'kmh' ? 'km/h' : 'mph') : 'per km'
  const jogs = run.blocks.some((b) => b.kind === 'recovery' && b.effort !== null)
  const field = (key: keyof ByFeelAnswer, label: string) => (
    <TextField
      value={value[key]}
      onChange={(text) => onChange({ ...value, [key]: indoor ? text : clockInput(text) })}
      validate={(text) => (speedPace(text, run.environment, context.unit) === undefined ? (indoor ? 'A speed like 14.0.' : 'A pace like 4:17.') : null)}
      inputMode={indoor ? 'decimal' : 'numeric'}
      className="grid gap-2"
    >
      <Label className="text-body">
        {label}, {unit}
      </Label>
      <Input placeholder={indoor ? '0.0' : 'm:ss'} autoComplete="off" className={inputClass} />
      <FieldError className="text-body-quiet font-bold text-ink" />
    </TextField>
  )
  return (
    <section aria-label="By-feel speeds" className="grid gap-4">
      <h2 className={groupLabel}>{indoor ? 'What speed did you run?' : 'What pace did you run?'}</h2>
      <p className="-mt-2 text-body-quiet text-muted">Optional. Kept with the log, and it never changes the Training paces.</p>
      <div className="flex flex-wrap gap-4">
        {field('hard', 'Hard reps')}
        {jogs && field('jog', 'Jogs')}
      </div>
    </section>
  )
}
