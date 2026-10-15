import { useCallback, useEffect, useLayoutEffect, useRef, useState, type FormEvent, type RefObject } from 'react'
import { Button, Form, Group, Input, Label, NumberField, Radio, RadioGroup } from 'react-aria-components'
import { motion } from 'motion/react'
import { nowMs } from '../../domain/clock'
import {
  addSet,
  answerPrompt,
  currentSet,
  endRest,
  finish,
  keepGoing,
  liftsStatus,
  logSet,
  predictedLiftsRpe,
  rpeChoices,
  restLeft,
  setLoad,
  setReps,
  setRpe,
  type LiveExercise,
  type LiveLifts,
  type LiveSet,
} from '../../domain/lifts'
import { clock } from '../../domain/paces'
import type { WorkingWeightSuggestion } from '../../domain/suggestion'
import { suggestionCopy } from '../coachCopy'
import { FieldLane } from '../components/FieldLane'
import { Icon } from '../components/Icons'
import { StripedNumeral } from '../components/StripedNumeral'
import { nb } from '../format'
import { DUR, dropIn, lane, LanePresence, play, riseIn, useEntrances, useMounted, wipeIn } from '../motion'
import { blockChangeCue, keepAwake, letSleep, unlockSound } from '../liveCues'
import { ALL_SETS_LINE, finishLine, liftsStartLine, loggedLine, REST_OVER_LINE, rpeLine } from '../liveCopy'
import { navigate, SCREEN_PATH } from '../router'
import {
  DiscardButton,
  finishBarClass,
  inputClass,
  lineButton,
  linkButton,
  OverallRpe,
  primaryButton,
  quietButton,
  toggleClass,
} from './liveUi'

/** What the finish sheet hands back to be saved as the Session log. */
export interface LiftsFinish {
  rpe: number
}


const stepClass =
  'grid size-11 cursor-pointer place-items-center rounded-sm shadow-[inset_0_0_0_2px_var(--edge)] hover:bg-sunk disabled:cursor-default disabled:opacity-40 data-focus-visible:outline-3 data-focus-visible:outline-offset-2 data-focus-visible:outline-link'
const logClass = 'min-h-11 cursor-pointer rounded-sm px-3.5 text-[15px] font-bold whitespace-nowrap'
/** The bar at the foot of a Live session, under the thumb: paper, an ink rule, the home-indicator inset. */
const liveBarClass =
  'border-t-2 border-ink bg-paper px-pad pt-3 pb-[calc(12px+env(safe-area-inset-bottom))] desktop:px-gutter'
/** On the cobalt rest bar: white edge at rest, inverted to white when picked, as the side rail does. */
const fieldToggle =
  'grid min-h-[54px] cursor-pointer place-items-center rounded-sm text-[17px] font-bold text-on-cobalt shadow-[inset_0_0_0_2px_var(--on-cobalt)] data-focus-visible:outline-3 data-focus-visible:outline-offset-2 data-focus-visible:outline-on-cobalt data-selected:bg-on-cobalt data-selected:text-cobalt'

/**
 * A Live Strength session: the cobalt field leads with the current exercise,
 * set and load; below, every set with its load steps and Log set, and the
 * RPE of each set once it's logged. A rest bar sits at the bottom after each
 * set, its clock written into the page without re-rendering the controls.
 */
export function Lifting({
  lifts,
  onChange,
  onSave,
  onDecide,
}: {
  lifts: LiveLifts
  onChange: (lifts: LiveLifts | null) => void
  onSave: (lifts: LiveLifts, finish: LiftsFinish) => void
  /** Records the answer to a Working weight prompt as the Suggestion's decision, as Today does. */
  onDecide: (suggestion: WorkingWeightSuggestion, decision: 'accepted' | 'kept') => void
}) {
  const entrances = useEntrances()
  const current = currentSet(lifts)
  const [say, setSay] = useState(() => liftsStartLine(lifts))
  const liftsRef = useRef(lifts)
  liftsRef.current = lifts
  const restTextRef = useRef<HTMLElement>(null)
  const restFillRef = useRef<HTMLElement>(null)
  /** The set whose RPE takes focus once it's logged, so the next tap is right there. */
  const [focusRpe, setFocusRpe] = useState<string | null>(null)

  const act = useCallback(
    (step: (lifts: LiveLifts, now: number) => LiveLifts) => {
      unlockSound()
      liftsRef.current = step(liftsRef.current, nowMs())
      onChange(liftsRef.current)
    },
    [onChange],
  )

  /** Writes the rest clock into the page without React. */
  const paint = useCallback((now: number) => {
    const { rest } = liftsRef.current
    const left = restLeft(liftsRef.current, now)
    if (!rest || left === null) return
    if (restTextRef.current) restTextRef.current.textContent = clock(Math.ceil(left - 0.001))
    if (restFillRef.current) restFillRef.current.style.width = `${Math.min(100, (1 - left / rest.seconds) * 100)}%`
  }, [])

  useLayoutEffect(() => paint(nowMs()))

  const restStarted = lifts.rest?.startedAt ?? null
  useEffect(() => {
    if (restStarted === null) return
    let timer = 0
    const tick = () => {
      const now = nowMs()
      const left = restLeft(liftsRef.current, now)
      if (left === null) return
      if (left <= 0) {
        blockChangeCue()
        setSay(REST_OVER_LINE)
        act(endRest)
        return
      }
      paint(now)
      const toNextSecond = (left * 1000) % 1000
      timer = window.setTimeout(tick, toNextSecond < 1 ? 1000 : toNextSecond)
    }
    tick()
    const visible = () => {
      if (document.visibilityState !== 'visible') return
      window.clearTimeout(timer)
      tick()
    }
    document.addEventListener('visibilitychange', visible)
    return () => {
      window.clearTimeout(timer)
      document.removeEventListener('visibilitychange', visible)
    }
  }, [restStarted, act, paint])

  useEffect(() => {
    if (lifts.ending) {
      letSleep()
      return
    }
    void keepAwake()
    const visible = () => document.visibilityState === 'visible' && void keepAwake()
    document.addEventListener('visibilitychange', visible)
    return () => document.removeEventListener('visibilitychange', visible)
  }, [lifts.ending])
  useEffect(() => letSleep, [])

  useEffect(() => {
    if (!focusRpe) return
    document.getElementById(focusRpe)?.querySelector<HTMLInputElement>('input:checked')?.focus({ preventScroll: true })
    setFocusRpe(null)
  }, [focusRpe])

  /** Log set, from its row or the bar: the rest starts, and focus goes to the set's RPE. */
  const logCurrent = (x: number, s: number) => {
    act((l, now) => logSet(l, x, s, now))
    setSay(loggedLine(s + 1, lifts.sets[x][s].rpe))
    setFocusRpe(rpeId(x, s))
  }

  const logged = lifts.sets.flat().filter((s) => s.done).length
  const total = lifts.sets.flat().length
  const exercise = current && lifts.exercises[current.exercise]
  const set = current && lifts.sets[current.exercise][current.set]

  return (
    <div className="flex min-h-dvh flex-col">
      {/* The field drops in from the top as the session opens, once. */}
      <motion.header
        {...play(dropIn, entrances)}
        className="on-field bg-cobalt px-pad pt-[calc(14px+env(safe-area-inset-top))] pb-5 text-on-cobalt desktop:px-gutter desktop:pb-7"
      >
        <div className="flex items-center justify-between gap-3">
          <h1 tabIndex={-1} className="text-[22px]">
            {nb(lifts.heading)}
          </h1>
          {!lifts.ending && (
            <Button
              onPress={() => act(finish)}
              className="min-h-11 cursor-pointer px-2 text-[17px] font-bold text-on-cobalt underline decoration-2 underline-offset-4 hover:decoration-[3px]"
            >
              End
            </Button>
          )}
        </div>

        {lifts.ending ? (
          <>
            <p className="mt-5 text-[20px] font-bold">{current ? 'Ended early' : 'Session over'}</p>
            <p className="mt-2 text-[18px] font-semibold">{finishLine(liftsStatus(lifts))}</p>
          </>
        ) : (
          <>
            {exercise && set ? (
              <>
                <p className="mt-3.5 text-[20px] font-bold">
                  {nb(`${exercise.name} · Set ${current.set + 1} of ${lifts.sets[current.exercise].length}`)}
                </p>
                <p className="mt-1.5 flex flex-wrap items-baseline gap-x-2.5">
                  <StripedNumeral value={set.pounds === null ? 'BW' : String(set.pounds)} className="text-numeral-lift" />
                  <span className="text-[24px] font-bold">
                    {nb(`${set.pounds === null ? 'bodyweight' : 'lb'} × ${exercise.repsWords}`)}
                  </span>
                </p>
              </>
            ) : (
              <p className="mt-3.5 text-[20px] font-bold">All sets logged.</p>
            )}
            <div role="img" aria-label={`${logged} of ${total} sets logged`} className="mt-4 grid gap-1.5">
              {lifts.exercises.map((_, x) => (
                <FieldLane
                  key={x}
                  value={lifts.sets[x].filter((s) => s.done).length / lifts.sets[x].length}
                  current={current?.exercise === x}
                />
              ))}
            </div>
            <p aria-live="polite" className="mt-3.5 min-h-6 text-[18px] font-semibold">
              {current ? say : ALL_SETS_LINE}
            </p>
          </>
        )}
      </motion.header>

      {/* On the finish sheet its actions sit on the screen's bottom edge, so no padding under them. */}
      <div className={`flex flex-1 flex-col px-pad desktop:max-w-plan desktop:px-gutter ${lifts.ending ? 'desktop:pb-6' : 'pb-6'}`}>
        {lifts.ending ? (
          <FinishSheet
            lifts={lifts}
            onKeepGoing={() => act(keepGoing)}
            onSave={(f) => onSave(lifts, f)}
            onDiscard={() => {
              onChange(null)
              navigate(SCREEN_PATH.today)
            }}
          />
        ) : (
          <>
            {lifts.prompts.map((p) => (
              <WeightPrompt
                key={p.id}
                suggestion={p}
                name={lifts.exercises.find((e) => e.lift === p.lift)?.name ?? p.lift}
                onDecide={(decision) => {
                  onDecide(p, decision)
                  act((l) => answerPrompt(l, p.id, decision))
                }}
              />
            ))}
            {lifts.exercises.map((e, x) => (
              <ExerciseSets
                key={x}
                exercise={e}
                index={x}
                sets={lifts.sets[x]}
                current={current?.exercise === x ? current.set : null}
                onLoad={(s, pounds) => act((l) => setLoad(l, x, s, pounds))}
                onLog={(s) => logCurrent(x, s)}
                onRpe={(s, rpe) => {
                  act((l) => setRpe(l, x, s, rpe))
                  setSay(rpeLine(rpe))
                }}
                onReps={(s, reps) => act((l) => setReps(l, x, s, reps))}
                onAddSet={() => act((l) => addSet(l, x))}
              />
            ))}
          </>
        )}
      </div>

      {!lifts.ending && (
        <div className="sticky bottom-0 z-10">
          {/* The rest strip rises over the set bar and drops away when rest ends; the bar under it never waits. */}
          <LanePresence popLayout>
          {lifts.rest ? (
            <motion.div key={`rest-${lifts.rest.exercise}-${lifts.rest.set}`} {...play(riseIn, entrances)}>
            <RestBar
              key={`${lifts.rest.exercise}-${lifts.rest.set}`}
              exercise={lifts.exercises[lifts.rest.exercise]}
              number={lifts.rest.set}
              next={
                current && exercise && set
                  ? { label: `${logLabel(current.set, set)}, ${exercise.name}`, words: logLabel(current.set, set) }
                  : null
              }
              onLog={() => current && logCurrent(current.exercise, current.set)}
              rpe={lifts.sets[lifts.rest.exercise][lifts.rest.set].rpe}
              textRef={restTextRef}
              fillRef={restFillRef}
              onRpe={(rpe) => {
                const { exercise: x, set: s } = lifts.rest!
                act((l) => setRpe(l, x, s, rpe))
                setSay(rpeLine(rpe))
              }}
              onSkip={() => act(endRest)}
            />
            </motion.div>
          ) : (
            <div key="bar" className={`${liveBarClass} flex gap-2.5`}>
              {current && exercise && set ? (
                <>
                  {set.pounds !== null && (
                    <div role="group" aria-label="Load for the next set" className="flex flex-none items-center gap-1.5">
                      <Button
                        aria-label="Lighter, next set"
                        isDisabled={set.pounds <= 0}
                        onPress={() => act((l) => setLoad(l, current.exercise, current.set, Math.max(0, set.pounds! - 5)))}
                        className={`${stepClass} size-[54px]`}
                      >
                        <Icon name="minus" />
                      </Button>
                      <Button
                        aria-label="Heavier, next set"
                        isDisabled={set.pounds >= 1000}
                        onPress={() => act((l) => setLoad(l, current.exercise, current.set, Math.min(1000, set.pounds! + 5)))}
                        className={`${stepClass} size-[54px]`}
                      >
                        <Icon name="plus" />
                      </Button>
                    </div>
                  )}
                  <Button
                    onPress={() => logCurrent(current.exercise, current.set)}
                    aria-label={`${logLabel(current.set, set)}, ${exercise.name}`}
                    className={`${primaryButton} desktop:max-w-80`}
                  >
                    {nb(logLabel(current.set, set))}
                  </Button>
                </>
              ) : (
                <Button onPress={() => act(finish)} className={`${primaryButton} desktop:max-w-80`}>
                  Finish session
                </Button>
              )}
            </div>
          )}
          </LanePresence>
        </div>
      )}
    </div>
  )
}

const rpeId = (exercise: number, set: number) => `rpe-${exercise}-${set}`

/** "Log set 2 · 190 lb": the set and the load the tap logs. */
const logLabel = (number: number, set: LiveSet) => `Log set ${number + 1} · ${set.pounds === null ? 'BW' : `${set.pounds} lb`}`

/**
 * The rest, under the thumb: the clock and Skip, the RPE the set was logged
 * at (the target, until changed) with the others one tap away, and the next
 * set's Log set for lifting before the clock runs out.
 */
function RestBar({
  exercise,
  number,
  next,
  onLog,
  rpe,
  textRef,
  fillRef,
  onRpe,
  onSkip,
}: {
  exercise: LiveExercise
  number: number
  /** The set after the rest: logging it early ends the rest, one tap. */
  next: { label: string; words: string } | null
  onLog: () => void
  rpe: number
  textRef: RefObject<HTMLElement | null>
  fillRef: RefObject<HTMLElement | null>
  onRpe: (rpe: number) => void
  onSkip: () => void
}) {
  const [rating, setRating] = useState(false)
  return (
    <div className="bg-cobalt px-pad pt-3 pb-[calc(12px+env(safe-area-inset-bottom))] text-on-cobalt desktop:px-gutter">
      <div className="flex items-center gap-3.5">
        <span className="text-[17px] font-bold">Rest</span>
        <span aria-hidden="true" className="relative h-2 flex-1 overflow-hidden bg-cobalt-soft">
          <i ref={fillRef} className="lane-fill absolute inset-y-0 left-0 bg-on-cobalt" />
        </span>
        <b ref={textRef} role="timer" aria-label="Rest left" className="text-[26px] font-black font-stretch-125%" />
        <Button
          onPress={onSkip}
          className="min-h-11 min-w-11 cursor-pointer px-2 text-[15px] font-bold text-on-cobalt underline decoration-2 underline-offset-4 data-focus-visible:outline-3 data-focus-visible:outline-offset-2 data-focus-visible:outline-on-cobalt"
        >
          Skip
        </Button>
      </div>
      {rating ? (
        <RadioGroup
          aria-label={`RPE for ${exercise.name}, set ${number + 1}, from the rest bar`}
          orientation="horizontal"
          value={String(rpe)}
          onChange={(v) => {
            onRpe(Number(v))
            setRating(false)
          }}
          className="mt-3 grid grid-cols-6 gap-1.5"
        >
          {rpeChoices(exercise.rpe, rpe).map((v) => (
            <Radio key={v} value={String(v)} autoFocus={v === rpe} className={fieldToggle}>
              {v}
            </Radio>
          ))}
        </RadioGroup>
      ) : (
        <div className="mt-3 flex gap-2.5">
          <Button
            onPress={() => setRating(true)}
            aria-label={`Set ${number + 1} at RPE ${rpe}. Change`}
            className={`${fieldToggle} flex-none px-4`}
          >
            {`RPE ${rpe}`}
          </Button>
          {next && (
            <Button
              onPress={onLog}
              aria-label={next.label}
              className="min-h-[54px] flex-1 cursor-pointer rounded-sm bg-on-cobalt px-5 text-[17px] font-bold text-cobalt data-focus-visible:outline-3 data-focus-visible:outline-offset-2 data-focus-visible:outline-on-cobalt"
            >
              {nb(next.words)}
            </Button>
          )}
        </div>
      )}
    </div>
  )
}

/**
 * A Working weight Suggestion for a lift in this session, asked before set 1:
 * Accept moves the lift's sets to the new weight, Keep leaves them. Either is
 * the Suggestion's decision, as on Today.
 */
function WeightPrompt({
  suggestion,
  name,
  onDecide,
}: {
  suggestion: WorkingWeightSuggestion
  name: string
  onDecide: (decision: 'accepted' | 'kept') => void
}) {
  const copy = suggestionCopy(suggestion)
  return (
    <section aria-label={`Working weight, ${name}`} className="border-b-2 border-ink py-4">
      <p className="text-[20px] font-bold">{nb(`${name}: ${suggestion.from.pounds} → ${suggestion.to.pounds} lb?`)}</p>
      <p className="mt-1 text-[14px] text-muted">{nb(copy.why)}</p>
      <div className="mt-2.5 flex gap-5">
        <Button onPress={() => onDecide('accepted')} className={linkButton}>
          Accept
        </Button>
        <Button onPress={() => onDecide('kept')} className={quietButton}>
          {copy.keep}
        </Button>
      </div>
    </section>
  )
}

/** Focus selects the whole load, so typing 225 replaces it; after the tap, or iOS puts the caret back. */
const selectAll = (event: { currentTarget: HTMLInputElement }) => {
  const input = event.currentTarget
  requestAnimationFrame(() => input.select())
}

function ExerciseSets({
  exercise,
  index,
  sets,
  current,
  onLoad,
  onLog,
  onRpe,
  onReps,
  onAddSet,
}: {
  exercise: LiveExercise
  index: number
  sets: LiveSet[]
  /** The set the screen leads with, when it's one of this Exercise's. */
  current: number | null
  onLoad: (set: number, pounds: number) => void
  onLog: (set: number) => void
  onRpe: (set: number, rpe: number) => void
  onReps: (set: number, reps: number) => void
  onAddSet: () => void
}) {
  const headingId = `exercise-${index}`
  const tag = [`${exercise.sets} × ${exercise.repsWords}`, exercise.rpeWords].filter((t): t is string => Boolean(t))
  return (
    <section aria-labelledby={headingId} className="border-b border-rule py-5">
      <div className="flex items-baseline justify-between gap-2.5">
        <h2 id={headingId} className="text-[24px]">
          {exercise.name}
        </h2>
        {/* Breaks only between its parts: "3 × 5", then "RPE 7". */}
        <span className="text-right text-[14px] font-semibold text-muted">
          {tag.map((part, i) => (
            <span key={part} className="whitespace-nowrap">
              {i > 0 && ' · '}
              {part}
            </span>
          ))}
        </span>
      </div>
      {exercise.note && <p className="mt-0.5 text-[14px] text-muted">{exercise.note}</p>}
      <ol className="mt-2.5 grid gap-1.5">
        {sets.map((set, s) => (
          <SetRow
            key={s}
            exercise={exercise}
            index={index}
            number={s}
            set={set}
            current={current === s}
            onLoad={(pounds) => onLoad(s, pounds)}
            onLog={() => onLog(s)}
            onRpe={(rpe) => onRpe(s, rpe)}
            onReps={(reps) => onReps(s, reps)}
          />
        ))}
      </ol>
      {exercise.calibrate && (
        <Button onPress={onAddSet} className={`mt-1 ${quietButton}`}>
          Another ramp set
        </Button>
      )}
    </section>
  )
}

function SetRow({
  exercise,
  index,
  number,
  set,
  current,
  onLoad,
  onLog,
  onRpe,
  onReps,
}: {
  exercise: LiveExercise
  index: number
  number: number
  set: LiveSet
  current: boolean
  onLoad: (pounds: number) => void
  onLog: () => void
  onRpe: (rpe: number) => void
  onReps: (reps: number) => void
}) {
  const name = `${exercise.name}, set ${number + 1}`
  const mounted = useMounted()
  const entrances = useEntrances()
  return (
    <li aria-label={name} aria-current={current ? 'step' : undefined}>
      <div className="grid min-h-[52px] grid-cols-[24px_1fr_auto] items-center gap-2.5">
        <span aria-hidden="true" className={`font-extrabold ${current ? 'text-ink' : 'text-muted'}`}>
          {number + 1}
        </span>
        {set.pounds === null ? (
          <span className="text-[20px] font-bold">Bodyweight</span>
        ) : (
          <NumberField
            value={set.pounds}
            onChange={(v) => Number.isFinite(v) && onLoad(v)}
            minValue={0}
            maxValue={1000}
            step={5}
            isDisabled={set.done}
            aria-label={`${name}, pounds`}
          >
            <Group className="flex items-center gap-2 text-[20px] font-bold">
              <Button slot="decrement" aria-label="Lighter" className={stepClass}>
                <Icon name="minus" />
              </Button>
              <span className="flex items-baseline">
                <Input
                  inputMode="numeric"
                  onFocus={selectAll}
                  className="h-11 w-[5ch] rounded-sm bg-transparent px-1 text-right text-[22px] shadow-[inset_0_-2px_0_var(--edge)] outline-none focus:shadow-[inset_0_-2px_0_var(--ink)] focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-link disabled:text-ink disabled:shadow-none"
                />
                <span className="ml-1">lb</span>
              </span>
              <Button slot="increment" aria-label="Heavier" className={stepClass}>
                <Icon name="plus" />
              </Button>
            </Group>
          </NumberField>
        )}
        {set.done ? (
          // Logged just now: the tick draws and the word wipes in. Opened already logged: it simply sits there.
          <motion.span
            {...play(wipeIn, mounted && entrances)}
            className="flex items-center gap-1 px-3.5 text-[15px] font-bold"
          >
            {/* Green as a graphic only: as text it falls short of 4.5:1 on paper. */}
            <svg viewBox="0 0 24 24" aria-hidden="true" className="size-5 fill-none stroke-good stroke-3">
              <motion.path
                d="M5 12.5l4.5 4.5L19 7.5"
                initial={mounted && entrances ? { pathLength: 0 } : false}
                animate={{ pathLength: 1 }}
                transition={lane(DUR.enter, 0.06)}
              />
            </svg>
            Logged
          </motion.span>
        ) : (
          <Button
            onPress={onLog}
            aria-label={`Log ${name}`}
            className={`${logClass} text-ink hover:bg-sunk data-focus-visible:outline-3 data-focus-visible:outline-offset-2 data-focus-visible:outline-link ${
              current ? 'shadow-[inset_0_0_0_2px_var(--ink)]' : 'shadow-[inset_0_0_0_2px_var(--edge)]'
            }`}
          >
            Log set
          </Button>
        )}
      </div>
      {set.done && <SetFeel exercise={exercise} index={index} number={number} set={set} onRpe={onRpe} onReps={onReps} />}
    </li>
  )
}

/** Under a logged set: its RPE, one tap, and the reps if they weren't the target. */
function SetFeel({
  exercise,
  index,
  number,
  set,
  onRpe,
  onReps,
}: {
  exercise: LiveExercise
  index: number
  number: number
  set: LiveSet
  onRpe: (rpe: number) => void
  onReps: (reps: number) => void
}) {
  const [changing, setChanging] = useState(false)
  const [reps, setRepsDraft] = useState(set.reps)
  const short = set.reps < exercise.reps

  function submit(event: FormEvent) {
    event.preventDefault()
    if (Number.isInteger(reps)) onReps(reps)
    setChanging(false)
  }

  return (
    <div className="mb-1.5 ml-[34px] grid gap-1">
      <RadioGroup
        id={rpeId(index, number)}
        aria-label={`RPE for ${exercise.name}, set ${number + 1}`}
        orientation="horizontal"
        value={String(set.rpe)}
        onChange={(v) => onRpe(Number(v))}
        className="grid grid-cols-[auto_repeat(6,minmax(0,1fr))] items-center gap-1.5"
      >
        <span aria-hidden="true" className="mr-0.5 text-[14px] font-bold text-muted">
          RPE
        </span>
        {rpeChoices(exercise.rpe, set.rpe).map((v) => (
          <Radio key={v} value={String(v)} className={toggleClass}>
            {v}
          </Radio>
        ))}
      </RadioGroup>
      {changing ? (
        <Form onSubmit={submit} className="flex flex-wrap items-end gap-3">
          <NumberField value={reps} onChange={setRepsDraft} minValue={0} maxValue={100} isRequired autoFocus className="grid gap-1">
            <Label className="text-[15px] font-bold">Reps done{exercise.repsWords.includes('/ leg') ? ', per leg' : ''}</Label>
            <Input inputMode="numeric" className={`${inputClass} w-24`} />
          </NumberField>
          <Button type="submit" className={`${lineButton} min-h-11 flex-none`}>
            Save
          </Button>
        </Form>
      ) : (
        <Button
          onPress={() => {
            setRepsDraft(set.reps)
            setChanging(true)
          }}
          aria-label={`Reps for ${exercise.name}, set ${number + 1}: ${set.reps}. Change`}
          className={`justify-self-start ${quietButton} ${short ? 'text-ink' : 'text-muted'}`}
        >
          {short ? `${set.reps} reps · Change` : `${set.reps} reps · Missed some?`}
        </Button>
      )}
    </div>
  )
}

/** The end: an overall RPE, then the log. Ended early, Keep going goes back to the sets. */
function FinishSheet({
  lifts,
  onKeepGoing,
  onSave,
  onDiscard,
}: {
  lifts: LiveLifts
  onKeepGoing: () => void
  onSave: (finish: LiftsFinish) => void
  onDiscard: () => void
}) {
  const [predicted] = useState(() => predictedLiftsRpe(lifts))
  const [rpe, setRpe] = useState<number | null>(predicted)
  const [missingRpe, setMissingRpe] = useState(false)
  const logged = lifts.sets.flat().filter((s) => s.done).length

  function submit(event: FormEvent) {
    event.preventDefault()
    if (rpe === null) {
      setMissingRpe(true)
      return
    }
    onSave({ rpe })
  }

  return (
    <Form onSubmit={submit} className="mt-4 flex flex-1 flex-col gap-6">
      <p className="text-body">
        {logged === 0
          ? 'No sets logged. It saves as Partial, with nothing for the Coach to go on.'
          : `${logged} ${logged === 1 ? 'set' : 'sets'} logged. The Coach reads every one for your Working weights.`}
      </p>
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
        <Button onPress={onKeepGoing} className={`${lineButton} desktop:flex-none`}>
          Keep going
        </Button>
      </div>
    </Form>
  )
}
