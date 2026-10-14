import { useCallback, useEffect, useLayoutEffect, useRef, useState, type FormEvent } from 'react'
import {
  Button,
  FieldError,
  Form,
  Input,
  Label,
  Link,
  NumberField,
  Text,
  TextField,
} from 'react-aria-components'
import {
  advance,
  answer,
  blockElapsed,
  blockLeft,
  distanceSeconds,
  end,
  isOver,
  liveStatus,
  liveTarget,
  nextBlock,
  pause,
  resume,
  type LiveBlock,
  type LiveRun,
  type LiveTarget,
} from '../../domain/live'
import { isLifts, type LiveLifts, type LiveSession } from '../../domain/lifts'
import { PACE_SECONDS } from '../../domain/log'
import { clock, KM_PER_MILE, parseClock, type RunContext } from '../../domain/paces'
import type { Lane } from '../../domain/program/types'
import { StripedNumeral } from '../components/StripedNumeral'
import { nb } from '../format'
import { blockChangeCue, keepAwake, letSleep, unlockSound } from '../liveCues'
import { finishLine, liveLine } from '../liveCopy'
import { navigate, SCREEN_PATH } from '../router'
import { validateTime } from './LogAfter'
import { Lifting, type LiftsFinish } from './LiveLifts'
import {
  DiscardButton,
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
 * and striped, and the time left; a lane per Block below; Pause and Skip
 * block pinned to the bottom where a thumb finds them.
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
}: {
  live: LiveSession | null
  /** Paces and units now; the Environment is the run's own. */
  runContext: RunContext
  onChange: (live: LiveSession | null) => void
  onSave: (run: LiveRun, finish: LiveFinish) => void
  onSaveLifts: (lifts: LiveLifts, finish: LiftsFinish) => void
}) {
  if (!live) {
    return (
      <div className="px-pad pt-6 desktop:px-gutter desktop:pt-7">
        <h1 tabIndex={-1} className="text-headline">
          Nothing running.
        </h1>
        <p className="mt-2 text-prescription">Start a Session from Today.</p>
        <Link href={SCREEN_PATH.today} className={`mt-4 inline-block ${linkButton}`}>
          ← Today
        </Link>
      </div>
    )
  }
  if (isLifts(live)) return <Lifting lifts={live} onChange={onChange} onSave={onSaveLifts} />
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
  const over = isOver(run)
  const paused = run.pausedAt !== null
  const block: LiveBlock | undefined = run.blocks[run.block]
  const target = block && targetFor(block, context)

  const runRef = useRef(run)
  runRef.current = run
  const timerRef = useRef<HTMLSpanElement>(null)
  const fillRef = useRef<HTMLElement>(null)

  /** Writes the clock into the page without React: the timer's text and the current lane's fill. */
  const paint = useCallback((now: number) => {
    const current = runRef.current
    const left = blockLeft(current, now)
    const elapsed = blockElapsed(current, now)
    if (timerRef.current) timerRef.current.textContent = timerText(left === null ? Math.floor(elapsed) : Math.ceil(left - 0.001))
    const seconds = current.blocks[current.block]?.seconds
    if (fillRef.current && seconds) fillRef.current.style.width = `${Math.min(100, (elapsed / seconds) * 100)}%`
  }, [])

  useLayoutEffect(() => paint(Date.now()))

  // One tick per second shown, on the timer's next whole second; none while paused.
  useEffect(() => {
    if (over || paused) return
    let timer = 0
    const tick = () => {
      const now = Date.now()
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

  const shownBlock = useRef(run.block)
  useEffect(() => {
    if (shownBlock.current === run.block) return
    shownBlock.current = run.block
    blockChangeCue()
  }, [run.block])

  /** Every control goes through here: the tap also lets the phone make sound. */
  const act = (step: (run: LiveRun, now: number) => LiveRun) => {
    unlockSound()
    runRef.current = step(runRef.current, Date.now())
    onChange(runRef.current)
  }

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="on-field bg-cobalt px-pad pt-[calc(14px+env(safe-area-inset-top))] pb-5 text-on-cobalt desktop:px-gutter desktop:pb-7">
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
            <p className="mt-3.5 text-[20px] font-bold">
              {nb(`${block.name} · ${blockLength(block)}`)}
            </p>
            {target ? (
              <p className="mt-1.5 flex flex-wrap items-baseline gap-x-2">
                <StripedNumeral value={target.value} className="text-numeral-live" />
                <span className="text-[24px] font-bold">{target.unit}</span>
              </p>
            ) : (
              <p className="mt-2 text-headline">{nb(feelWords(block))}</p>
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
                aria-label={block.seconds === null ? `Time on the ${block.name}` : `Time left in ${block.name}`}
                className="text-figure font-stretch-125%"
              />
            </div>
            {block.detail.length > 0 && (
              <ul className="mt-3 text-body">
                {block.detail.map((d) => (
                  <li key={d}>{nb(d)}</li>
                ))}
              </ul>
            )}
            <p aria-live="polite" className="mt-3.5 min-h-6 text-[18px] font-semibold">
              {liveLine(block, run)}
            </p>
          </>
        )}
      </header>

      <div className="flex-1 px-pad pb-6 desktop:max-w-plan desktop:px-gutter">
        <HeldCheck run={run} context={context} onAnswer={(b, pace, actual) => act((r) => answer(r, b, pace, actual))} />
        {over ? (
          <FinishSheet run={run} context={context} onKeepGoing={() => act(resume)} onSave={(f) => onSave(run, f)} onDiscard={() => {
              onChange(null)
              navigate(SCREEN_PATH.today)
            }}
          />
        ) : (
          <Lanes run={run} context={context} fillRef={fillRef} />
        )}
      </div>

      {!over && block && (
        <div className="sticky bottom-0 flex gap-2.5 border-t-2 border-ink bg-paper px-pad pt-3 pb-[calc(12px+env(safe-area-inset-bottom))] desktop:px-gutter">
          <Button onPress={() => act(paused ? resume : pause)} className={`${primaryButton} desktop:max-w-60`}>
            {paused ? 'Resume' : 'Pause'}
          </Button>
          <Button onPress={() => act(nextBlock)} className={`${lineButton} desktop:max-w-60`}>
            {block.seconds === null ? `Finished ${km(block.meters ?? 0)}` : 'Skip block'}
          </Button>
        </div>
      )}
    </div>
  )
}

/** The hero target: the exact speed or pace, the RPE before there are paces, or the distance of a 5 km. */
function targetFor(block: LiveBlock, context: RunContext): LiveTarget | null {
  if (block.kind === 'distance' && block.meters) {
    return { value: String(block.meters / 1000), unit: 'km', incline: null, pace: null, words: km(block.meters) }
  }
  return liveTarget(block, context)
}

/** Where there's nothing to dial: what the Block is about instead. */
function feelWords(block: LiveBlock): string {
  if (block.effort && 'feel' in block.effort) {
    return { easy: 'Easy', hard: 'Hard, by feel', controlled: 'Controlled', relaxed: 'Relaxed', 'all-out': 'All-out' }[
      block.effort.feel
    ]
  }
  if (block.effort) return 'Easy'
  return block.kind === 'drills' ? 'Drills' : 'Walk'
}

/** "12 min", "90 s", "5 km" */
function blockLength(block: LiveBlock): string {
  if (block.seconds === null) return km(block.meters ?? 0)
  return block.seconds % 60 === 0 ? `${block.seconds / 60} min` : `${block.seconds} s`
}

/** "12.3 km/h", "4:52/km", "RPE 6–7" */
function targetShort({ value, unit }: LiveTarget): string {
  if (unit === 'RPE') return `RPE ${value}`
  return unit === '/km' ? `${value}/km` : `${value} ${unit}`
}

const km = (meters: number) => (meters % 1000 === 0 ? `${meters / 1000} km` : `${meters} m`)

/** 300 → "05:00", 4000 → "66:40" */
const timerText = (seconds: number) => clock(seconds).padStart(5, '0')

function Lanes({
  run,
  context,
  fillRef,
}: {
  run: LiveRun
  context: RunContext
  fillRef: React.RefObject<HTMLElement | null>
}) {
  return (
    <ol aria-label="Blocks" className="mt-5 grid gap-3">
      {run.blocks.map((b, i) => {
        const current = i === run.block
        const target = b.kind === 'rep' ? liveTarget(b, context) : null
        return (
          <li
            key={i}
            aria-current={current ? 'step' : undefined}
            className={`grid grid-cols-[1fr_auto] gap-x-2.5 gap-y-1.5 ${current ? 'text-[17px] font-extrabold' : 'text-[15px] font-semibold'}`}
          >
            <span>
              {b.name}
              {i < run.block && <span className="sr-only">{run.skipped.includes(i) ? ', skipped' : ', done'}</span>}
            </span>
            <span className="text-muted">{target ? targetShort(target) : blockLength(b)}</span>
            <span aria-hidden="true" className={`relative col-span-full block overflow-hidden bg-rule ${current ? 'h-[26px]' : 'h-3'}`}>
              <i
                ref={current ? fillRef : undefined}
                className={`lane-fill absolute inset-y-0 left-0 ${LANE_BG[b.lane]}`}
                style={{ width: i < run.block ? '100%' : current ? undefined : '0%' }}
              />
            </span>
          </li>
        )
      })}
    </ol>
  )
}

/** After each rep, one tap: Held it, or Changed with what was run instead. The oldest rep waiting goes first. */
function HeldCheck({
  run,
  context,
  onAnswer,
}: {
  run: LiveRun
  context: RunContext
  onAnswer: (block: number, targetPace: number | null, actualPace: number | null) => void
}) {
  const [changing, setChanging] = useState<number | null>(null)
  const [speed, setSpeed] = useState(Number.NaN)
  const [pace, setPace] = useState('')
  const asked = run.asks[0]
  if (asked === undefined) return null

  const block = run.blocks[asked]
  const target = liveTarget(block, context)
  const indoor = run.environment === 'indoor'
  const unit = context.unit === 'kmh' ? 'km/h' : 'mph'
  const question = target?.pace ? `held ${targetShort(target)}?` : 'done as written?'

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
              onChange={setPace}
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
  onSave,
  onDiscard,
}: {
  run: LiveRun
  context: RunContext
  onKeepGoing: () => void
  onSave: (finish: LiveFinish) => void
  onDiscard: () => void
}) {
  const status = liveStatus(run)
  const covered = distanceSeconds(run)
  const result = run.type === '5k-test' && status === 'done'
  const indoor = run.environment === 'indoor'
  const mile = context.unit === 'mph'
  const [time, setTime] = useState(covered === null ? '' : clock(covered))
  const [distance, setDistance] = useState(Number.NaN)
  const [rpe, setRpe] = useState<number | null>(null)
  const [missingRpe, setMissingRpe] = useState(false)

  function submit(event: FormEvent) {
    event.preventDefault()
    if (rpe === null) {
      setMissingRpe(true)
      return
    }
    const resultSeconds = result ? parseClock(time) : null
    if (result && (resultSeconds === null || validateTime(time))) return
    const meters = indoor && Number.isFinite(distance) ? Math.round(distance * (mile ? KM_PER_MILE * 1000 : 1000)) : null
    onSave({ rpe, distanceMeters: meters, resultSeconds })
  }

  return (
    <Form onSubmit={submit} className="mt-4 grid gap-6 border-t-2 border-ink pt-4">
      {result && (
        <TextField value={time} onChange={setTime} isRequired validate={validateTime} inputMode="numeric" className="grid gap-2">
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
        onChange={(v) => {
          setRpe(v)
          setMissingRpe(false)
        }}
      />

      <div className="flex flex-wrap gap-2.5">
        <Button type="submit" className={`${primaryButton} desktop:flex-none`}>
          Save log
        </Button>
        {run.ending && (
          <Button onPress={onKeepGoing} className={`${lineButton} desktop:flex-none`}>
            Keep going
          </Button>
        )}
      </div>
      <DiscardButton onDiscard={onDiscard} />
    </Form>
  )
}
