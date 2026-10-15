import { useState } from 'react'
import { Button, Link } from 'react-aria-components'
import { addDays } from '../../domain/calendar'
import type { Activity } from '../../domain/activity'
import type { ActivityAttached, ActivityQuestion, BucketEntry, CoachDay, PhaseProgress, RestReason } from '../../domain/coach'
import { isLive, type LiveSession } from '../../domain/lifts'
import type { Environment, RunContext } from '../../domain/paces'
import { painLevel, type PainArea } from '../../domain/pain'
import { describeSession, SESSION_TYPES } from '../../domain/program/describe'
import type { Session } from '../../domain/program/types'
import type { Settings } from '../../domain/settings'
import type { Decision, Suggestion } from '../../domain/suggestion'
import { outsideWeekLine, painLine, recoveryWhy, shortSleepLine, suggestionCopy, waitingLine } from '../coachCopy'
import { FieldLane } from '../components/FieldLane'
import { LaneChip } from '../components/LaneChip'
import { buttonBase, lineAction, primaryAction, quietButton } from '../components/actions'
import { answered, PainFields, type PainAnswer } from '../components/PainFields'
import { ActionBar } from '../components/ActionBar'
import { asksPain, PAIN_FREE, PainStep, type PainAtStart } from '../components/PainStep'
import { Segmented } from '../components/Segmented'
import { SettingsPopover, type StartingPointEdit } from '../components/SettingsPopover'
import { StripedNumeral } from '../components/StripedNumeral'
import {
  activitySummary,
  longDay,
  nb,
  plural,
  shortDay,
  shortWeekday,
  STATUS_LABEL,
  timeOfDay,
  weekday,
  weekRange,
} from '../format'
import { logPath, SCREEN_PATH, weekPath } from '../router'


/**
 * Today: one number (days to the race), one instruction (Up next), then the
 * Week's Bucket as rows. On desktop the cobalt band runs full width with the
 * countdown and Phase lanes side by side, then two equal columns.
 */
export function Today({
  day,
  weekCount,
  pending,
  error,
  onPick,
  runContext,
  onEnvironment,
  settings,
  onSettings,
  startingPoint,
  onDecide,
  live,
  onStart,
  onSomethingHurts,
  treadmill,
  onAnswer,
}: {
  day: CoachDay
  weekCount: number
  /** Logs saved on this device that the server hasn't taken yet. */
  pending: number
  /** A log the server refused or the device couldn't store, said once under Up next. */
  error: string | null
  /** Makes a Session of the Bucket today's Session instead of Up next. */
  onPick: (week: number, sessionId: string) => void
  /** Accepts, Keeps or (with 'open') undoes a Suggestion. */
  onDecide: (suggestion: Suggestion, decision: Decision) => void
  /** How a Session's runs read today: exact speeds or paces once there is a 5K test. */
  runContext: (week: number, session: Session) => RunContext
  /** Overrides the month's Environment for one Session. */
  onEnvironment: (week: number, session: Session, environment: Environment) => void
  settings: Settings
  onSettings: (patch: Partial<Settings>) => void
  /** The Starting point's estimates, as Settings edits them. */
  startingPoint: StartingPointEdit
  /** The Live session running on this device, if any. */
  live: LiveSession | null
  /** Start session, after the pain step: a Pain report, then a Live session of Up next. */
  onStart: (week: number, session: Session, pain: PainAtStart) => void
  /** A Pain report given from Today, outside any Session. */
  onSomethingHurts: (score: number, area: PainArea) => void
  /** Whether a run of the watch's was on a treadmill. */
  treadmill: (activity: Activity) => boolean
  /** "Which Session was this?": a Session of its Week, or (both null) none of them. */
  onAnswer: (activity: Activity, week: number | null, sessionId: string | null) => void
}) {
  return (
    <section
      aria-labelledby="today-heading"
      className="desktop:grid desktop:grid-cols-2 desktop:gap-x-12 desktop:px-gutter"
    >
      <FieldBand
        day={day}
        weekCount={weekCount}
        settings={settings}
        onSettings={onSettings}
        startingPoint={startingPoint}
      />
      <UpNext
        day={day}
        weekCount={weekCount}
        pending={pending}
        error={error}
        onDecide={onDecide}
        runContext={runContext}
        onEnvironment={onEnvironment}
        live={live}
        onStart={onStart}
        onSomethingHurts={onSomethingHurts}
        treadmill={treadmill}
        onAnswer={onAnswer}
      />
      <ThisWeek day={day} onPick={onPick} treadmill={treadmill} />
    </section>
  )
}

function FieldBand({
  day,
  weekCount,
  settings,
  onSettings,
  startingPoint,
}: {
  day: CoachDay
  weekCount: number
  settings: Settings
  onSettings: (patch: Partial<Settings>) => void
  startingPoint: StartingPointEdit
}) {
  const { position } = day
  return (
    <header className="on-field bg-cobalt px-pad pt-4 pb-5 text-on-cobalt desktop:col-span-full desktop:-mx-gutter desktop:grid desktop:grid-cols-[auto_minmax(0,1fr)] desktop:items-end desktop:gap-x-14 desktop:gap-y-2 desktop:px-gutter desktop:py-7">
      <div className="flex items-center justify-between gap-3 desktop:col-span-full desktop:justify-end">
        <span className="text-brand uppercase font-stretch-125% desktop:hidden">Compromised</span>
        {/* The athlete's initial opens Settings. */}
        <SettingsPopover settings={settings} onChange={onSettings} startingPoint={startingPoint} />
      </div>

      <p className="mt-3 desktop:mt-0">
        {/* The wrapper carries the numeral's size so its line box matches the prototype's. */}
        <span className="block text-numeral leading-[normal]">
          <StripedNumeral value={String(Math.abs(day.daysToRace))} />
        </span>
        <span className="mt-2.5 block text-[18px] font-semibold">
          {countdownLabel(day.daysToRace)} · {longDay(day.raceDay)}
        </span>
      </p>

      <div>
        <PhaseLanes phases={day.phases} />
        <p className="mt-3 flex justify-between gap-3 text-[15px] font-semibold">
          {position.kind === 'in-week' && (
            <>
              <span>
                Week {position.week} of {weekCount} · {day.phases.find((p) => p.current)?.name}
              </span>
              <span>{weekRange(position.startDate, position.endDate)}</span>
            </>
          )}
          {position.kind === 'before-start' && (
            <>
              <span>Week 1 starts {shortDay(position.startsOn)}</span>
              <span>{plural(position.daysToStart, 'day')} to go</span>
            </>
          )}
          {position.kind === 'finished' && <span>All {weekCount} Weeks done</span>}
        </p>
      </div>
    </header>
  )
}

function countdownLabel(daysToRace: number): string {
  if (daysToRace < 0) return `${daysToRace === -1 ? 'day' : 'days'} since the race`
  if (daysToRace === 0) return 'days to the race. It’s today'
  return `${daysToRace === 1 ? 'day' : 'days'} to the race`
}

function PhaseLanes({ phases }: { phases: PhaseProgress[] }) {
  const summary = phases
    .map((p) => {
      const done = Math.round(p.completion * 100)
      return `${p.name} ${done === 100 ? 'done' : done === 0 ? 'not started' : `${done}% done`}`
    })
    .join(', ')
  return (
    <div role="img" aria-label={`Phases: ${summary}`} className="mt-[18px] grid gap-1.5 desktop:mt-0">
      {phases.map((phase) => (
        <div
          key={phase.id}
          className={`grid grid-cols-[128px_1fr] items-center gap-2.5 text-label ${phase.current ? 'font-extrabold' : 'font-semibold'}`}
        >
          <span>{phase.name}</span>
          <FieldLane value={phase.completion} current={phase.current} />
        </div>
      ))}
    </div>
  )
}

function UpNext({
  day,
  weekCount,
  pending,
  error,
  onDecide,
  runContext,
  onEnvironment,
  live,
  onStart,
  onSomethingHurts,
  treadmill,
  onAnswer,
}: {
  day: CoachDay
  weekCount: number
  pending: number
  error: string | null
  onDecide: (suggestion: Suggestion, decision: Decision) => void
  runContext: (week: number, session: Session) => RunContext
  onEnvironment: (week: number, session: Session, environment: Environment) => void
  live: LiveSession | null
  onStart: (week: number, session: Session, pain: PainAtStart) => void
  onSomethingHurts: (score: number, area: PainArea) => void
  treadmill: (activity: Activity) => boolean
  onAnswer: (activity: Activity, week: number | null, sessionId: string | null) => void
}) {
  const [asking, setAsking] = useState(false)
  /** Back from the pain step with Not now: focus returns to Start. */
  const [refocus, setRefocus] = useState(false)
  const { position, upNext } = day
  const standing = day.pain?.report ?? null
  const previousPain = standing?.score ?? null
  const upNextWeek = day.bucket.find((e) => e.state === 'next')?.week
  const run = upNext && upNextWeek ? runContext(upNextWeek, upNext) : undefined
  /** Where to start a Session early: Week 1 before the Program, the next Week once this one is all logged. */
  const weekDone = day.bucket.length > 0 && day.bucket.every((e) => e.log !== null)
  const ahead = upNext
    ? null
    : position.kind === 'before-start'
      ? weekDone && weekCount > 1
        ? 2
        : 1
      : position.kind === 'in-week' && day.rest?.kind === 'week-done' && position.week < weekCount
        ? position.week + 1
        : null
  let heading: string
  let target: string
  let meta = ''

  if (upNext) {
    const description = describeSession(upNext, run, day.workingWeights)
    heading = description.heading
    target = description.target
    // Paces from the Starting point read as estimates wherever they set a run's target.
    const estimated =
      run?.paces?.estimate && describeSession(upNext, { ...run, paces: null }, day.workingWeights).target !== target
    meta = [description.meta, estimated && 'Estimated paces'].filter(Boolean).join(' · ')
  } else if (position.kind === 'before-start') {
    const when =
      position.daysToStart === 1
        ? 'tomorrow'
        : position.daysToStart <= 6
          ? weekday(position.startsOn)
          : shortDay(position.startsOn)
    heading = `Week 1 starts ${when}.`
    target = `${plural(position.daysToStart, 'day')} of nothing. Enjoy them.`
    meta = `${longDay(position.startsOn)} · Week 1’s Sessions are below`
  } else if (position.kind === 'in-week' && day.rest) {
    ;({ heading, target, meta } = restCopy(day.rest, day.today, position.week, position.endDate, weekCount))
  } else if (position.kind === 'in-week') {
    heading = `Week ${position.week} isn’t in the app yet.`
    target = 'Train from the plan document until it is.'
  } else {
    heading = 'Program done.'
    target = `Race day was ${longDay(day.raceDay)}.`
  }

  return (
    <div className="px-pad pt-5 desktop:px-0 desktop:pt-7">
      <h1 id="today-heading" tabIndex={-1} className="text-headline">
        {nb(heading)}
      </h1>
      <p className="mt-2 text-prescription">{nb(target)}</p>
      {meta && <p className="mt-1 text-body-quiet text-muted">{meta}</p>}
      {upNext && position.kind === 'before-start' && (
        <p className="mt-3.5 text-body">
          {nb(outsideWeekLine('early', 1, position.startsOn, addDays(position.startsOn, 6)))}
        </p>
      )}
      {ahead && (
        <Link
          href={weekPath(ahead)}
          className="mt-2 inline-flex min-h-11 items-center text-[15px] font-bold text-link underline decoration-2 underline-offset-4 hover:decoration-[3px]"
        >
          Can’t wait? Start a Week {ahead} Session early
        </Link>
      )}
      {day.recovery && day.recoveryChange === 'short-sleep' && (
        <p className="mt-3 text-body">
          {shortSleepLine(day.recovery.night.sleepMinutes, day.recoveryCut)}
          {/* With low HRV too, the Suggestion below carries the numbers. */}
          {!day.recovery.easyDay && (
            <span className="text-muted">
              {' '}
              {recoveryWhy(day.recovery.night.sleepMinutes, day.recovery.night.hrvMs, day.recovery.hrvMean)}
            </span>
          )}
        </p>
      )}
      {upNext && upNextWeek && run && dependsOnEnvironment(upNext, run) && (
        <Segmented
          label="Where"
          labelClassName="sr-only"
          className="mt-3 max-w-72"
          value={run.environment}
          options={[
            { value: 'indoor', label: 'Indoor' },
            { value: 'outdoor', label: 'Outdoor' },
          ]}
          onChange={(environment) => onEnvironment(upNextWeek, upNext, environment)}
        />
      )}
      {upNext && upNextWeek && !live && isLive(upNext) && (
        <Link
          href={logPath(upNextWeek, upNext.id)}
          className="mt-1 inline-flex min-h-11 items-center text-[15px] font-bold text-link underline decoration-2 underline-offset-4 hover:decoration-[3px]"
        >
          Log it after instead
        </Link>
      )}
      {live ? (
        <ActionBar label="Up next">
          <div className="flex gap-2.5">
            <Link href={SCREEN_PATH.live} className={`${primaryAction} no-underline`}>
              Resume {nb(live.heading)}
            </Link>
          </div>
        </ActionBar>
      ) : upNext && upNextWeek && asking && standing && isLive(upNext) ? (
        <ActionBar label="Up next">
          <PainStep
            standing={standing}
            onAnswer={(pain) => {
              setAsking(false)
              onStart(upNextWeek, upNext, pain)
            }}
            onCancel={() => {
              setAsking(false)
              setRefocus(true)
            }}
          />
        </ActionBar>
      ) : (
        upNext &&
        upNextWeek && (
          <ActionBar label="Up next">
            <div className="flex gap-2.5">
              {isLive(upNext) ? (
                <Button
                  autoFocus={refocus}
                  onPress={() => (asksPain(standing) ? setAsking(true) : onStart(upNextWeek, upNext, { ...PAIN_FREE }))}
                  className={primaryAction}
                >
                  {nb(`Start ${SESSION_TYPES[upNext.type].name}`)}
                </Button>
              ) : (
                <Link href={logPath(upNextWeek, upNext.id)} className={`${primaryAction} no-underline`}>
                  Log after
                </Link>
              )}
            </div>
          </ActionBar>
        )
      )}
      {!asking && <SomethingHurts previous={previousPain} onReport={onSomethingHurts} />}
      <div aria-live="polite">
        {error && <p className="mt-3 text-body">{error}</p>}
        {pending > 0 && (
          <p className="mt-3 text-body-quiet text-muted">{plural(pending, 'log')} on this phone, waiting to sync.</p>
        )}
      </div>
      {day.suggestions
        // Decided ones stay for the rest of the day, so Undo is one tap away.
        .filter((s) => s.decision === 'open' || s.decidedOn === day.today)
        .map((s) => (
          <SuggestionNote key={s.id} suggestion={s} onDecide={(d) => onDecide(s, d)} />
        ))}
      {day.activitiesAttached.map((a) => (
        <AttachedNote
          key={a.activity.id}
          attached={a}
          treadmill={treadmill(a.activity)}
          onDetach={() => onAnswer(a.activity, null, null)}
        />
      ))}
      {day.activityQuestions.map((q) => (
        <WhichSession
          key={q.activity.id}
          question={q}
          treadmill={treadmill(q.activity)}
          onAnswer={(week, sessionId) => onAnswer(q.activity, week, sessionId)}
        />
      ))}
      {day.bucket
        .filter((e) => e.activity && treadmill(e.activity) && e.log?.status !== 'skipped' && e.log?.distanceMeters == null)
        .map((e) => (
          <ConsoleDistance key={e.activity!.id} entry={e} />
        ))}
    </div>
  )
}

/** A workout the Coach attached on its own: said in one line, undone in one tap. */
function AttachedNote({
  attached,
  treadmill,
  onDetach,
}: {
  attached: ActivityAttached
  treadmill: boolean
  onDetach: () => void
}) {
  const { activity, session } = attached
  return (
    <section aria-label="From the watch" className="mt-[18px] border-t-2 border-t-ink py-3.5 desktop:border-b desktop:border-b-rule">
      <p className="text-[17px] leading-[1.3] font-semibold">
        {nb(`The watch’s ${activity.workoutType.toLowerCase()} went to ${SESSION_TYPES[session.type].name}.`)}
      </p>
      <p className="mt-1 text-[14px] text-muted">
        {nb(`${timeOfDay(activity.startedAt)} · ${activitySummary(activity, treadmill)}`)}
      </p>
      <Button onPress={onDetach} className={`mt-1 ${quietButton}`}>
        Not that Session
      </Button>
    </section>
  )
}

/** A workout more than one Session fits: one tap says which, or that it was none of them. */
function WhichSession({
  question,
  treadmill,
  onAnswer,
}: {
  question: ActivityQuestion
  treadmill: boolean
  onAnswer: (week: number | null, sessionId: string | null) => void
}) {
  const { activity, candidates } = question
  return (
    <section
      aria-label="Which Session was this?"
      className="mt-[18px] border-t-2 border-t-ink py-3.5 desktop:border-b desktop:border-b-rule"
    >
      <p className="text-[17px] leading-[1.3] font-semibold">Which Session was this?</p>
      <p className="mt-1 text-[14px] text-muted">
        {nb(`${activity.workoutType} from the watch, ${shortWeekday(activity.date)} ${timeOfDay(activity.startedAt)} · ${activitySummary(activity, treadmill)}`)}
      </p>
      <div className="mt-2.5 flex flex-wrap gap-x-5">
        {candidates.map((c) => (
          <Button key={`${c.week}/${c.session.id}`} onPress={() => onAnswer(c.week, c.session.id)} className={linkButton}>
            {SESSION_TYPES[c.session.type].name}
          </Button>
        ))}
        <Button onPress={() => onAnswer(null, null)} className={quietButton}>
          None of these
        </Button>
      </div>
    </section>
  )
}

/** A treadmill run attached to a Session: the watch's distance is a guess, so ask for the console's. */
function ConsoleDistance({ entry }: { entry: BucketEntry }) {
  const { activity, session, week } = entry
  if (!activity) return null
  return (
    <section aria-label="Console distance" className="mt-[18px] border-t-2 border-t-ink py-3.5 desktop:border-b desktop:border-b-rule">
      <p className="text-[17px] leading-[1.3] font-semibold">
        {nb(`${SESSION_TYPES[session.type].name} on the treadmill, ${shortWeekday(activity.date)}. What did the console say?`)}
      </p>
      <p className="mt-1 text-[14px] text-muted">
        {nb(`The watch guesses distance indoors. Kept its ${activitySummary(activity, true)}.`)}
      </p>
      <Link href={logPath(week, session.id)} className={`mt-2.5 ${linkButton}`}>
        Add console distance
      </Link>
    </section>
  )
}

/** Whether the Session's target reads differently indoors and out: it has a run at a Training pace. */
function dependsOnEnvironment(session: Session, run: RunContext): boolean {
  const indoor = describeSession(session, { ...run, environment: 'indoor' }).target
  return indoor !== describeSession(session, { ...run, environment: 'outdoor' }).target
}

/** The prototype's link buttons: Accept in link blue, underlined; Keep and Undo quiet, in ink. */
const linkButton = `${buttonBase} text-link underline decoration-2 underline-offset-4 hover:decoration-[3px]`

/** The Coach's Suggestion between ink rules: the line, the facts, then Accept and Keep (or Undo). */
function SuggestionNote({ suggestion, onDecide }: { suggestion: Suggestion; onDecide: (d: Decision) => void }) {
  const copy = suggestionCopy(suggestion)
  const { decision } = suggestion
  return (
    <section
      aria-label="Coach’s Suggestion"
      aria-live="polite"
      className="mt-[18px] border-t-2 border-t-ink py-3.5 desktop:border-b desktop:border-b-rule"
    >
      <p className="text-[17px] leading-[1.3] font-semibold">
        {decision === 'open' ? copy.line : decision === 'accepted' ? copy.accepted : copy.kept}
      </p>
      {decision === 'open' && <p className="mt-1 text-[14px] text-muted">{nb(copy.why)}</p>}
      <div className="mt-2.5 flex gap-5">
        {decision === 'open' ? (
          <>
            <Button onPress={() => onDecide('accepted')} className={linkButton}>
              Accept
            </Button>
            <Button onPress={() => onDecide('kept')} className={quietButton}>
              {copy.keep}
            </Button>
          </>
        ) : (
          <Button onPress={() => onDecide('open')} className={quietButton}>
            Undo
          </Button>
        )}
      </div>
    </section>
  )
}

/** Something hurts: a Pain report from Today at any time, outside any Session. */
function SomethingHurts({
  previous,
  onReport,
}: {
  previous: number | null
  onReport: (score: number, area: PainArea) => void
}) {
  const [open, setOpen] = useState(false)
  const [answer, setAnswer] = useState<PainAnswer>({ score: null, area: null })
  const [noted, setNoted] = useState<string | null>(null)

  if (!open) {
    return (
      <div className="mt-3">
        <Button
          onPress={() => {
            setOpen(true)
            setNoted(null)
          }}
          aria-expanded={false}
          className={linkButton}
        >
          Something hurts
        </Button>
        {noted && (
          <p role="status" className="text-body-quiet text-muted">
            {noted}
          </p>
        )}
      </div>
    )
  }

  return (
    <section aria-labelledby="something-hurts-heading" className="mt-4 grid gap-5 border-t-2 border-ink pt-3.5">
      <h2 id="something-hurts-heading" tabIndex={-1} className="text-title">
        Something hurts
      </h2>
      <PainFields value={answer} onChange={setAnswer} />
      <div className="flex gap-2.5">
        <Button
          isDisabled={!answered(answer)}
          onPress={() => {
            if (!answered(answer)) return
            onReport(answer.score, answer.area)
            const level = painLevel(answer.score, previous)
            // From 3, or rising, the Coach's Suggestion says the rest.
            setNoted(level ? null : painLine(answer.score, level, false))
            setAnswer({ score: null, area: null })
            setOpen(false)
          }}
          className={`${primaryAction} data-disabled:cursor-default data-disabled:opacity-50`}
        >
          Tell the Coach
        </Button>
        <Button onPress={() => setOpen(false)} className={lineAction}>
          Cancel
        </Button>
      </div>
    </section>
  )
}

/** Blunt, with the reason first (PRODUCT.md, Coach voice). */
function restCopy(
  rest: RestReason,
  today: CoachDay['today'],
  week: number,
  weekEnd: CoachDay['today'],
  weekCount: number,
): { heading: string; target: string; meta: string } {
  switch (rest.kind) {
    case 'week-done':
      return {
        heading: 'Week done.',
        target: 'Go eat something with protein in it.',
        meta: week < weekCount ? `Week ${week + 1} starts ${shortDay(addDays(weekEnd, 1))}` : '',
      }
    case 'hard-yesterday':
      return {
        heading: 'Rest day.',
        target: 'Hard yesterday, and the Week has room. Legs up.',
        meta: 'Tap a Session below to train anyway',
      }
    case 'hard-today':
      return {
        heading: 'Done for today.',
        target: 'One Hard session a day. The rest of the Week fits.',
        meta: 'Tap a Session below to train anyway',
      }
    case 'speed-after-load':
      return {
        heading: 'Rest day.',
        target: 'Speed on legs that just lifted or pushed a sled? No. It waits a day.',
        meta: 'Tap Speed below to do it anyway',
      }
    case 'waiting':
      return {
        heading: 'Rest.',
        target: waitingLine(rest.session, rest.date, today),
        meta: longDay(rest.date),
      }
  }
}

function ThisWeek({
  day,
  onPick,
  treadmill,
}: {
  day: CoachDay
  onPick: (week: number, sessionId: string) => void
  treadmill: (activity: Activity) => boolean
}) {
  const { week, position, bucket } = day
  if (!week) return null

  const inWeek = position.kind === 'in-week'
  // Before the Program, Week 1's Sessions can be picked to do early.
  const interactive = inWeek || position.kind === 'before-start'
  const left = bucket.filter((e) => !e.session.optional && !e.log).length
  // Rows that can still be made today's: not logged, not already Next, not pinned to another day.
  const pickable = bucket.some((e) => e.pickable && !e.log && e.state !== 'next')
  const aside = inWeek
    ? `${plural(left, 'Session')} left · ${plural(position.daysLeft, 'day')}`
    : `from ${shortDay(week.startDate)}`

  return (
    <div className="px-pad desktop:px-0 desktop:pt-7">
      <h2 className="mt-section flex items-baseline justify-between gap-3 border-t-2 border-ink pt-3.5 text-title desktop:mt-[22px] desktop:border-t-0 desktop:pt-0">
        {inWeek ? 'This Week' : `Week ${week.number}`}
        <small className="text-[14px] font-medium tracking-normal text-muted font-stretch-100%">{aside}</small>
      </h2>
      <ul className="mt-1.5">
        {bucket.map((entry) => (
          <BucketRow
            key={`${entry.week}/${entry.session.id}`}
            entry={entry}
            interactive={interactive && entry.pickable}
            onPick={() => onPick(entry.week, entry.session.id)}
            treadmill={treadmill}
          />
        ))}
      </ul>
      {interactive && pickable && (
        <p className="mt-2.5 text-[14px] text-muted">
          {inWeek ? 'Tap any Session to do it today instead.' : 'Tap any Session to do it today, early.'}
        </p>
      )}
    </div>
  )
}

const rowClass = 'grid w-full grid-cols-[36px_1fr_auto] items-center gap-3 py-3.5 text-left'

/**
 * One Session of the Bucket. Planned rows are buttons that make the Session
 * today's; logged rows link to their log; Up next is plain, it's already today's.
 */
function BucketRow({
  entry,
  interactive,
  onPick,
  treadmill,
}: {
  entry: BucketEntry
  interactive: boolean
  onPick: () => void
  treadmill: (activity: Activity) => boolean
}) {
  const { session, state, log, week, carriedUntil, activity } = entry
  const type = SESSION_TYPES[session.type]
  const content = (
    <>
      <LaneChip lane={type.lane} />
      <span>
        <span
          className={`block text-[17px] font-bold ${state === 'done' ? 'text-muted line-through decoration-2' : ''} group-hover:underline group-hover:decoration-2 group-hover:underline-offset-4`}
        >
          {type.name}
        </span>
        <span className="text-[14px] text-muted">
          {nb(
            carriedUntil
              ? `Week ${week}’s Key session, until ${shortWeekday(carriedUntil)} · ${describeSession(session).summary}`
              : describeSession(session).summary,
          )}
        </span>
        {activity && (
          <span className="block text-[14px] text-muted">
            {nb(`Watch, ${shortWeekday(activity.date)}: ${activitySummary(activity, treadmill(activity))}`)}
          </span>
        )}
      </span>
      <span className="text-[14px] font-bold">
        {state === 'next' ? (
          <span className="inline-block rounded-sm bg-cobalt px-2 py-1 text-label text-on-cobalt">Next</span>
        ) : log ? (
          state === 'done' ? (
            <>
              <span className="sr-only">{STATUS_LABEL.done}, </span>
              {shortWeekday(log.date)}
            </>
          ) : (
            STATUS_LABEL[log.status]
          )
        ) : session.optional ? (
          'Optional'
        ) : session.key ? (
          'Key'
        ) : null}
      </span>
    </>
  )

  return (
    <li className="border-b border-rule">
      {!interactive || state === 'next' ? (
        <div className={rowClass}>{content}</div>
      ) : log ? (
        <Link href={logPath(week, session.id)} className={`group ${rowClass} text-ink no-underline`}>
          {content}
        </Link>
      ) : (
        <Button onPress={onPick} className={`group ${rowClass} cursor-pointer`}>
          {content}
        </Button>
      )}
    </li>
  )
}
