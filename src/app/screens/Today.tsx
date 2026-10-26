import { useEffect, useState } from 'react'
import { Button, Link } from 'react-aria-components'
import { motion } from 'motion/react'
import { addDays, daysBetween } from '../../domain/calendar'
import type { Activity } from '../../domain/activity'
import type { ActivityAttached, ActivityQuestion, BucketEntry, CoachDay, PhaseProgress, RestReason } from '../../domain/coach'
import { isLive, type LiveSession } from '../../domain/lifts'
import type { Environment, RunContext } from '../../domain/paces'
import { painLevel, type PainArea } from '../../domain/pain'
import { describeSession, LIFT_NAME, SESSION_TYPES } from '../../domain/program/describe'
import { finishClock } from '../../domain/recap'
import type { Program, Session, Station, StationId } from '../../domain/program/types'
import type { RacePlan } from '../../domain/racePlan'
import type { Settings } from '../../domain/settings'
import type { ServerTrouble } from '../sync/syncer'
import type { Decision, Suggestion, WorkingWeightSuggestion } from '../../domain/suggestion'
import { heldCopy, liftChange, liftsCopy, suggestionBlocks, VISIBLE_BLOCKS, type SuggestionBlock } from '../suggestionBlocks'
import {
  outsideWeekLine,
  painLine,
  recoveryWhy,
  shortSleepLine,
  skippedTodayLine,
  suggestionCopy,
  waitingLine,
} from '../coachCopy'
import { FieldLane } from '../components/FieldLane'
import { LaneChip } from '../components/LaneChip'
import { buttonBase, lineAction, primaryAction, quietButton } from '../components/actions'
import { answered, PainFields, type PainAnswer } from '../components/PainFields'
import { ActionBar } from '../components/ActionBar'
import { PAIN_FREE, painSuggestionFor, type PainAtStart } from '../components/PainStep'
import { asksAtStart, StartStep } from '../components/StartStep'
import { Segmented } from '../components/Segmented'
import { SessionSheet, useSheet, type SheetAction } from '../components/SessionSheet'
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
import { DUR, lane, play, useEntrances, useMounted, wipeIn } from '../motion'
import { logPath, SCREEN_PATH, weekPath } from '../router'
import { ProgramRecapPanel, RaceLead, WhatsNext, type AfterRace } from './AfterRace'
import { RaceCard } from './RaceCard'


/**
 * Today: one number (days to the race), one instruction (Up next), then the
 * Week's Bucket as rows. On desktop the cobalt band runs full width with the
 * countdown and Phase lanes side by side, then two equal columns.
 */
export function Today({
  day,
  weekCount,
  stations,
  pending,
  error,
  server,
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
  race,
  afterRace,
}: {
  day: CoachDay
  weekCount: number
  /** The Program's Stations, for a Prescription's HYROX lines. */
  stations: Record<StationId, Station>
  /** The race card, the day before Race day and on it: it leads, and Up next follows it. */
  race: { plan: RacePlan; program: Program } | null
  /** From the day after Race day: the result and the Program recap, in place of Up next and the Week. */
  afterRace: AfterRace | null
  /** Logs saved on this device that the server hasn't taken yet. */
  pending: number
  /** A log the server refused or the device couldn't store, said once under Up next. */
  error: string | null
  /** The server is failing, or Cloudflare Access wants a sign-in: said under Up next until a sync goes through. */
  server: ServerTrouble | null
  /** Makes a Session of the Bucket today's Session instead of Up next. */
  onPick: (week: number, sessionId: string) => void
  /** Accepts, Keeps or (with 'open') undoes a Suggestion. */
  onDecide: (suggestions: Suggestion | Suggestion[], decision: Decision) => void
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
  onStart: (week: number, session: Session, pain: PainAtStart, environment: Environment | null) => void
  /** A Pain report given from Today, outside any Session. */
  onSomethingHurts: (score: number, area: PainArea) => void
  /** Whether a run of the watch's was on a treadmill. */
  treadmill: (activity: Activity) => boolean
  /** "Which Session was this?": a Session of its Week, or (both null) none of them. */
  onAnswer: (activity: Activity, week: number | null, sessionId: string | null) => void
}) {
  const [sheet, showSheet, closeSheet] = useSheet<{ week: number; sessionId: string }>()
  /** Bumped by a pick from the sheet: focus goes to Up next, now that Session. */
  const [landed, setLanded] = useState(0)
  useEffect(() => {
    if (!landed) return
    // After the Modal has put focus back on the row it was opened from.
    const frame = requestAnimationFrame(() =>
      requestAnimationFrame(() => document.querySelector<HTMLElement>('[data-up-next-heading]')?.focus()),
    )
    return () => cancelAnimationFrame(frame)
  }, [landed])
  const open = sheet && day.bucket.find((e) => e.week === sheet.week && e.session.id === sheet.sessionId)
  const action: SheetAction | null = !open
    ? null
    : open.state === 'next' || !open.pickable
      ? { kind: 'none' }
      : live
        ? { kind: 'running', heading: live.heading }
        : {
            kind: 'pick',
            label: day.position.kind === 'before-start' ? 'Do it today, early' : 'Do it today instead',
            onPick: () => {
              closeSheet()
              onPick(open.week, open.session.id)
              setLanded((n) => n + 1)
            },
          }
  const openSheet = (entry: BucketEntry) => showSheet({ week: entry.week, sessionId: entry.session.id })

  return (
    <section
      aria-labelledby="today-heading"
      className={`desktop:grid desktop:grid-cols-2 desktop:gap-x-12 desktop:px-gutter ${afterRace ? 'desktop:grid-rows-[auto_auto_1fr]' : ''}`}
    >
      <FieldBand
        day={day}
        weekCount={weekCount}
        settings={settings}
        onSettings={onSettings}
        startingPoint={startingPoint}
        finish={afterRace?.result.state === 'finished' ? afterRace.result.seconds : null}
        after={afterRace !== null}
      />
      {afterRace ? (
        <>
          <RaceLead race={afterRace}>
            <SomethingHurts previous={day.pain?.report.score ?? null} onReport={onSomethingHurts} />
            <SyncLine pending={pending} error={error} server={server} />
          </RaceLead>
          <ProgramRecapPanel recap={afterRace.recap} />
          <WhatsNext />
        </>
      ) : (
        <>
          {race && <RaceCard plan={race.plan} program={race.program} raceDay={day.daysToRace === 0} />}
          <UpNext
            day={day}
            lead={!race}
            weekCount={weekCount}
            pending={pending}
            error={error}
            server={server}
            onDecide={onDecide}
            runContext={runContext}
            onEnvironment={onEnvironment}
            live={live}
            onStart={onStart}
            onSomethingHurts={onSomethingHurts}
            treadmill={treadmill}
            onAnswer={onAnswer}
            onShow={openSheet}
          />
          <ThisWeek day={day} onOpen={openSheet} treadmill={treadmill} />
        </>
      )}
      {open && action && (
        <SessionSheet
          session={open.session}
          line={bucketLine(open)}
          stations={stations}
          run={runContext(open.week, open.session)}
          weights={day.workingWeights}
          action={action}
          onClose={closeSheet}
        />
      )}
    </section>
  )
}

const COUNTDOWN_SEEN = 'compromised:countdown-seen'

/** Whether Today has already opened on `today` in this tab: the countdown wipes on only the first time. */
function seenToday(today: string): boolean {
  try {
    return sessionStorage.getItem(COUNTDOWN_SEEN) === today
  } catch {
    return true
  }
}

function markSeen(today: string) {
  try {
    sessionStorage.setItem(COUNTDOWN_SEEN, today)
  } catch {
    // No storage: the count simply stays put.
  }
}

function FieldBand({
  day,
  weekCount,
  settings,
  onSettings,
  startingPoint,
  finish,
  after,
}: {
  day: CoachDay
  weekCount: number
  settings: Settings
  onSettings: (patch: Partial<Settings>) => void
  startingPoint: StartingPointEdit
  /** The race's finish time once it's logged: it takes the countdown's place, the one number the Program was for. */
  finish: number | null
  /** Past Race day: the footer counts the Weeks done, not the Week. */
  after: boolean
}) {
  const { position } = day
  const [unveil] = useState(() => !seenToday(day.today))
  const entrances = useEntrances()
  useEffect(() => markSeen(day.today), [day.today])
  return (
    <header
      className={`on-field bg-cobalt px-pad pt-4 pb-5 text-on-cobalt desktop:col-span-full desktop:-mx-gutter desktop:grid desktop:items-end desktop:gap-x-14 desktop:gap-y-2 desktop:px-gutter desktop:py-7 ${
        // The finish time sizes itself to its column, so that column needs a width of its own.
        finish !== null ? 'desktop:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]' : 'desktop:grid-cols-[auto_minmax(0,1fr)]'
      }`}
    >
      <div className="flex items-center justify-between gap-3 desktop:col-span-full desktop:justify-end">
        <span className="text-brand uppercase font-stretch-125% desktop:hidden">Compromised</span>
        {/* The athlete's initial opens Settings. */}
        <SettingsPopover settings={settings} onChange={onSettings} startingPoint={startingPoint} />
      </div>

      {finish !== null ? (
        // Seven characters: the numeral sizes itself to its column (a container).
        <p className="@container mt-3 desktop:mt-0">
          <StripedNumeral value={finishClock(finish)} className="text-numeral-finish" />
          <span className="mt-2.5 block text-[18px] font-semibold">HYROX finish · {longDay(day.raceDay)}</span>
        </p>
      ) : (
        <p className="mt-3 desktop:mt-0">
          {/* The wrapper carries the numeral's size so its line box matches the prototype's. */}
          <span className="block text-numeral leading-[normal]">
            {/* The day's first look: the count wipes on left to right, like a scoreboard changing over. */}
            <motion.span
              className="inline-block"
              initial={unveil && entrances ? { clipPath: 'inset(0 100% 0 0)' } : false}
              animate={{ clipPath: 'inset(0 0% 0 0)' }}
              transition={lane(DUR.fill, 0.1)}
            >
              <StripedNumeral value={String(Math.abs(day.daysToRace))} />
            </motion.span>
          </span>
          <span className="mt-2.5 block text-[18px] font-semibold">
            {countdownLabel(day.daysToRace)} · {longDay(day.raceDay)}
          </span>
        </p>
      )}

      <div>
        <PhaseLanes phases={day.phases} />
        <p className="mt-3 flex justify-between gap-3 text-[15px] font-semibold">
          {after ? (
            <>
              <span>All {weekCount} Weeks done</span>
              {/* Without the finish time the numeral already counts the days. */}
              {finish !== null && <span>{plural(-day.daysToRace, 'day')} since the race</span>}
            </>
          ) : position.kind === 'in-week' && (
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
          {!after && position.kind === 'finished' && <span>All {weekCount} Weeks done</span>}
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
      {phases.map((phase, i) => (
        <div
          key={phase.id}
          className={`grid grid-cols-[128px_1fr] items-center gap-2.5 text-label ${phase.current ? 'font-extrabold' : 'font-semibold'}`}
        >
          <span>{phase.name}</span>
          <FieldLane value={phase.completion} current={phase.current} index={i} />
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
  server,
  onDecide,
  runContext,
  onEnvironment,
  live,
  onStart,
  onSomethingHurts,
  treadmill,
  onAnswer,
  onShow,
  lead,
}: {
  day: CoachDay
  /** Up next leads Today unless the race card does; then its heading steps down a level. */
  lead: boolean
  weekCount: number
  pending: number
  error: string | null
  server: ServerTrouble | null
  onDecide: (suggestions: Suggestion | Suggestion[], decision: Decision) => void
  runContext: (week: number, session: Session) => RunContext
  onEnvironment: (week: number, session: Session, environment: Environment) => void
  live: LiveSession | null
  onStart: (week: number, session: Session, pain: PainAtStart, environment: Environment | null) => void
  onSomethingHurts: (score: number, area: PainArea) => void
  treadmill: (activity: Activity) => boolean
  onAnswer: (activity: Activity, week: number | null, sessionId: string | null) => void
  /** Opens a Session's Prescription in the sheet. */
  onShow: (entry: BucketEntry) => void
}) {
  const [asking, setAsking] = useState(false)
  const entrances = useEntrances()
  const mounted = useMounted()
  /** Back from Start's questions with Not now: focus returns to Start. */
  const [refocus, setRefocus] = useState(false)
  const { position, upNext } = day
  const standing = day.pain?.report ?? null
  const painSuggestion = painSuggestionFor(day.suggestions, standing)
  const previousPain = standing?.score ?? null
  const upNextEntry = day.bucket.find((e) => e.state === 'next')
  const upNextWeek = upNextEntry?.week
  const run = upNext && upNextWeek ? runContext(upNextWeek, upNext) : undefined
  /** Where to start a Session early: Week 1 before the Program, the next Week once nothing in this one is left to do. */
  const weekDone = day.bucket.length > 0 && day.bucket.every((e) => !e.toDo)
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
    // Skipped earlier and back as Up next: say so, or it reads like the Coach forgot.
    const skippedOn = upNextEntry?.log?.status === 'skipped' ? upNextEntry.log.date : null
    meta = [skippedOn && `Skipped ${weekday(skippedOn)}, still counts`, description.meta, estimated && 'Estimated paces']
      .filter(Boolean)
      .join(' · ')
  } else if (position.kind === 'before-start') {
    const when =
      position.daysToStart === 1
        ? 'tomorrow'
        : position.daysToStart <= 6
          ? weekday(position.startsOn)
          : shortDay(position.startsOn)
    heading = `Week 1 starts ${when}.`
    // The masthead already carries the date; this line is just the Coach.
    target = `${plural(position.daysToStart, 'day')} of nothing. Enjoy them.`
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
    <div className={lead ? 'px-pad pt-5 desktop:px-0 desktop:pt-7' : 'mt-section px-pad desktop:px-0'}>
      {/* A Session picked from its sheet wipes in as the new Up next. */}
      <motion.div key={upNextEntry ? `${upNextEntry.week}/${upNextEntry.session.id}` : 'none'} {...play(wipeIn, mounted && entrances)}>
        {lead ? (
          <h1 id="today-heading" data-up-next-heading tabIndex={-1} className="text-headline">
            {nb(heading)}
          </h1>
        ) : (
          <h2 data-up-next-heading tabIndex={-1} className="border-t-2 border-ink pt-3.5 text-title">
            {nb(heading)}
          </h2>
        )}
        <p className="mt-2 text-prescription">{nb(target)}</p>
        {meta && <p className="mt-1 text-body-quiet text-muted">{meta}</p>}
      </motion.div>
      {upNextEntry && (
        <Button
          onPress={() => onShow(upNextEntry)}
          aria-haspopup="dialog"
          className="mt-1 inline-flex min-h-11 cursor-pointer items-center text-[15px] font-bold text-link underline decoration-2 underline-offset-4 hover:decoration-[3px] data-focus-visible:outline-3 data-focus-visible:outline-offset-2 data-focus-visible:outline-link"
        >
          Show the Prescription
        </Button>
      )}
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
      {!asking && upNext && upNextWeek && run && dependsOnEnvironment(upNext, run) && (
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
      {live ? (
        <ActionBar label="Up next">
          <div className="flex gap-2.5">
            <Link href={SCREEN_PATH.live} className={`${primaryAction} no-underline`}>
              Resume {nb(live.heading)}
            </Link>
          </div>
        </ActionBar>
      ) : upNext && upNextWeek && run && asking && isLive(upNext) ? (
        <ActionBar label="Up next">
          <StartStep
            session={upNext}
            standing={standing}
            suggestion={painSuggestion}
            environment={run.environment}
            onStart={(pain, environment) => {
              setAsking(false)
              onStart(upNextWeek, upNext, pain, environment)
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
                  onPress={() => (asksAtStart(upNext, standing) ? setAsking(true) : onStart(upNextWeek, upNext, { ...PAIN_FREE }, null))}
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
      <SyncLine pending={pending} error={error} server={server} />
      <CoachSuggestions
        // While the pain step asks, it carries the pain Suggestion: asked once, not twice.
        day={asking && painSuggestion ? { ...day, suggestions: day.suggestions.filter((s) => s !== painSuggestion) } : day}
        onDecide={onDecide}
      />
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
        // Not logged yet, the note's Log it asks for the console's distance itself.
        .filter((e) => e.activity && treadmill(e.activity) && e.log && e.log.status !== 'skipped' && e.log.distanceMeters == null)
        .map((e) => (
          <ConsoleDistance key={e.activity!.id} entry={e} />
        ))}
    </div>
  )
}

/**
 * A log the server refused, said once; a server that can't take anything, said
 * until it can; and how many logs are still on this phone.
 */
function SyncLine({ pending, error, server }: { pending: number; error: string | null; server: ServerTrouble | null }) {
  return (
    <div aria-live="polite">
      {error && <p className="mt-3 text-body">{error}</p>}
      {server === 'failing' && (
        <p className="mt-3 text-body">
          The server is failing, so nothing syncs: logs stay on this phone, and last night’s Recovery can’t arrive.
        </p>
      )}
      {server === 'signed-out' && (
        <div className="mt-3">
          <p className="text-body">Signed out of Cloudflare Access, so nothing syncs.</p>
          {/* A full load goes through Access, which shows its sign-in; the app's own requests can't. */}
          <Button onPress={() => window.location.reload()} className={linkButton}>
            Sign in again
          </Button>
        </div>
      )}
      {pending > 0 && (
        <p className="mt-3 text-body-quiet text-muted">{plural(pending, 'log')} on this phone, waiting to sync.</p>
      )}
    </div>
  )
}

/**
 * A workout attached to a Session: said in one line, undone in one tap, and,
 * while the Session isn't logged, logged in one more (Log after, filled in
 * from the watch).
 */
function AttachedNote({
  attached,
  treadmill,
  onDetach,
}: {
  attached: ActivityAttached
  treadmill: boolean
  onDetach: () => void
}) {
  const { activity, session, week, by, logged } = attached
  const name = SESSION_TYPES[session.type].name
  return (
    <section
      aria-label="From the watch"
      aria-live="polite"
      className="mt-[18px] border-t-2 border-t-ink py-3.5 desktop:border-b desktop:border-b-rule"
    >
      <p className="text-[17px] leading-[1.3] font-semibold">
        {by === 'coach'
          ? nb(`The watch’s ${activity.workoutType.toLowerCase()} went to ${name}.`)
          : nb(`${name} it was. Not logged yet.`)}
      </p>
      <p className="mt-1 text-[14px] text-muted">
        {nb(`${shortWeekday(activity.date)} ${timeOfDay(activity.startedAt)} · ${activitySummary(activity, treadmill)}`)}
        {!logged && (treadmill ? nb(' · Bring the console’s distance.') : nb(' · The watch filled in the rest.'))}
      </p>
      <div className="mt-1 flex flex-wrap gap-x-5">
        {!logged && (
          <Link href={logPath(week, session.id)} className={linkButton}>
            Log it
          </Link>
        )}
        <Button onPress={onDetach} className={quietButton}>
          Not that Session
        </Button>
      </div>
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
  const { activity, candidates, guess } = question
  return (
    <section
      aria-label="Which Session was this?"
      className="mt-[18px] border-t-2 border-t-ink py-3.5 desktop:border-b desktop:border-b-rule"
    >
      <p className="text-[17px] leading-[1.3] font-semibold">Which Session was this?</p>
      <p className="mt-1 text-[14px] text-muted">
        {nb(`${activity.workoutType} from the watch, ${shortWeekday(activity.date)} ${timeOfDay(activity.startedAt)} · ${activitySummary(activity, treadmill)}`)}
      </p>
      {guess && <p className="mt-1 text-[14px] text-ink">{nb(guessLine(question, guess))}</p>}
      <div className="mt-2.5 flex flex-wrap gap-x-5">
        {candidates.map((c) => (
          <Button
            key={`${c.week}/${c.session.id}`}
            onPress={() => onAnswer(c.week, c.session.id)}
            // With a guess, it leads in link blue and the others step back to ink.
            className={!guess || c === guess ? linkButton : `${quietButton} underline decoration-1 underline-offset-4`}
          >
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

/** Why the Coach guessed what it did: the heart rate when the watch has one, else the minutes. */
function guessLine({ activity, candidates }: ActivityQuestion, guess: ActivityQuestion['candidates'][number]): string {
  const name = SESSION_TYPES[guess.session.type].name
  const next = candidates.find((c) => c !== guess)!
  return activity.averageHeartRate !== null
    ? `The Coach’s guess: ${name}. ${activity.minutes} min at ${activity.averageHeartRate} bpm is no ${SESSION_TYPES[next.session.type].name}.`
    : `The Coach’s guess: ${name}. ${activity.minutes} min is closest to its ${guess.session.minutes}.`
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

/**
 * The Coach's Suggestions, most important first: at most two blocks before
 * This Week, the rest one tap away. Lift increases held by a lighter Week get
 * one line instead.
 */
function CoachSuggestions({
  day,
  onDecide,
}: {
  day: CoachDay
  onDecide: (suggestions: Suggestion | Suggestion[], decision: Decision) => void
}) {
  const [more, setMore] = useState(false)
  const blocks = suggestionBlocks(day.suggestions, day.today)
  const folded = blocks.length - VISIBLE_BLOCKS
  const block = (b: SuggestionBlock) =>
    b.kind === 'one' ? (
      <SuggestionNote key={b.suggestion.id} suggestion={b.suggestion} onDecide={(d) => onDecide(b.suggestion, d)} />
    ) : (
      <LiftsNote key="lifts" lifts={b.lifts} onDecide={onDecide} />
    )
  return (
    <>
      {blocks.slice(0, VISIBLE_BLOCKS).map(block)}
      {folded > 0 &&
        (more ? (
          blocks.slice(VISIBLE_BLOCKS).map(block)
        ) : (
          <Button onPress={() => setMore(true)} aria-expanded={false} className={`mt-1 ${quietButton}`}>
            {folded} more from the Coach
          </Button>
        ))}
      {day.heldIncreases.length > 0 && <HeldNote day={day} />}
    </>
  )
}

/**
 * Every Working weight change as one Suggestion: Accept all or Keep all in a
 * tap, Undo in another, or open the list and decide lift by lift.
 */
function LiftsNote({
  lifts,
  onDecide,
}: {
  lifts: WorkingWeightSuggestion[]
  onDecide: (suggestions: Suggestion[], decision: Decision) => void
}) {
  const [oneByOne, setOneByOne] = useState(false)
  const open = lifts.filter((s) => s.decision === 'open')
  const copy = liftsCopy(open.length > 0 ? open : lifts)
  // Once nothing is open the one Undo says it all.
  const listed = open.length > 0 && (oneByOne || open.length < lifts.length)
  return (
    <section
      aria-label="Coach’s Suggestion: lifts"
      aria-live="polite"
      className="mt-[18px] border-t-2 border-t-ink py-3.5 desktop:border-b desktop:border-b-rule"
    >
      <p className="text-[17px] leading-[1.3] font-semibold">{open.length > 0 ? copy.line : liftsCopy(lifts).decided}</p>
      {open.length > 0 && <p className="mt-1 text-[14px] text-muted">{nb(copy.why)}</p>}
      <div className="mt-2.5 flex flex-wrap gap-x-5">
        {open.length > 0 ? (
          <>
            <Button onPress={() => onDecide(open, 'accepted')} className={linkButton}>
              Accept all
            </Button>
            <Button onPress={() => onDecide(open, 'kept')} className={quietButton}>
              Keep all
            </Button>
            {!listed && (
              <Button onPress={() => setOneByOne(true)} aria-expanded={false} className={quietButton}>
                One by one
              </Button>
            )}
          </>
        ) : (
          <Button onPress={() => onDecide(lifts, 'open')} className={quietButton}>
            Undo
          </Button>
        )}
      </div>
      {listed && (
        <ul aria-label="Each lift" className="mt-1.5 border-t border-t-rule">
          {lifts.map((s) => (
            <li key={s.id} className="grid grid-cols-[1fr_auto] items-center gap-x-4 border-b border-b-rule py-1">
              <span className="text-[15px] leading-[1.3] tabular-nums">
                <span className="font-semibold">
                  {LIFT_NAME[s.lift]}{' '}
                  <span className="whitespace-nowrap">
                    {s.from.pounds} → {s.to.pounds} lb
                  </span>
                </span>
                {s.decision !== 'open' && (
                  <span className="text-muted"> · {s.decision === 'accepted' ? 'accepted' : 'kept'}</span>
                )}
              </span>
              <span className="flex gap-5">
                {s.decision === 'open' ? (
                  <>
                    <Button
                      onPress={() => onDecide([s], 'accepted')}
                      aria-label={`Accept ${liftChange(s)}`}
                      className={linkButton}
                    >
                      Accept
                    </Button>
                    <Button onPress={() => onDecide([s], 'kept')} aria-label={`Keep ${s.from.pounds} lb`} className={quietButton}>
                      Keep
                    </Button>
                  </>
                ) : (
                  <Button onPress={() => onDecide([s], 'open')} aria-label={`Undo ${liftChange(s)}`} className={quietButton}>
                    Undo
                  </Button>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

/** Increases earned while the Week is lighter: said once, applied the Monday after, nothing to decide. */
function HeldNote({ day }: { day: CoachDay }) {
  const copy = heldCopy(day.heldIncreases, day.today)
  return (
    <section aria-label="From the Coach" className="mt-[18px] border-t-2 border-t-ink py-3.5 desktop:border-b desktop:border-b-rule">
      <p className="text-[17px] leading-[1.3] font-semibold">{copy.line}</p>
      <p className="mt-1 text-[14px] text-muted">{nb(copy.why)}</p>
    </section>
  )
}

/** The Coach's Suggestion between ink rules: the line, the facts, then Accept and Keep (or Undo). */
function SuggestionNote({ suggestion, onDecide }: { suggestion: Suggestion; onDecide: (d: Decision) => void }) {
  const copy = suggestionCopy(suggestion)
  const { decision } = suggestion
  const mounted = useMounted()
  const entrances = useEntrances()
  return (
    <section
      aria-label="Coach’s Suggestion"
      aria-live="polite"
      className="mt-[18px] border-t-2 border-t-ink py-3.5 desktop:border-b desktop:border-b-rule"
    >
      {/* Decided or undone: the Coach's new line wipes in over the old one. */}
      <motion.p
        key={decision}
        {...play(wipeIn, mounted && entrances)}
        className="text-[17px] leading-[1.3] font-semibold"
      >
        {decision === 'open' ? copy.line : decision === 'accepted' ? copy.accepted : copy.kept}
      </motion.p>
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
    case 'skipped-today':
      return {
        heading: today === weekEnd ? 'Week over.' : 'Skipped.',
        target: skippedTodayLine(rest.sessions, rest.lastDay, daysBetween(today, weekEnd)),
        meta: rest.lastDay
          ? today === weekEnd && week < weekCount
            ? `Week ${week + 1} starts ${shortDay(addDays(weekEnd, 1))}`
            : ''
          : `Tap ${rest.sessions.length === 1 ? 'it' : 'one'} below to do it today anyway`,
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
  onOpen,
  treadmill,
}: {
  day: CoachDay
  onOpen: (entry: BucketEntry) => void
  treadmill: (activity: Activity) => boolean
}) {
  const { week, position, bucket } = day
  if (!week) return null

  const inWeek = position.kind === 'in-week'
  // Before the Program, Week 1's Sessions can be opened and picked to do early.
  const interactive = inWeek || position.kind === 'before-start'
  const left = bucket.filter((e) => !e.session.optional && e.toDo).length
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
            interactive={interactive}
            onOpen={() => onOpen(entry)}
            treadmill={treadmill}
          />
        ))}
      </ul>
    </div>
  )
}

const rowClass = 'grid w-full grid-cols-[36px_1fr_auto] items-center gap-3 py-3.5 text-left'

/**
 * One Session of the Bucket. Up next and rows still to do (Planned, or
 * Skipped with days left) open the Session's sheet, where it can be made
 * today's; other logged rows link to their log.
 */
function BucketRow({
  entry,
  interactive,
  onOpen,
  treadmill,
}: {
  entry: BucketEntry
  interactive: boolean
  onOpen: () => void
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
      {!interactive ? (
        <div className={rowClass}>{content}</div>
      ) : log && !entry.toDo && state !== 'next' ? (
        <Link href={logPath(week, session.id)} className={`group ${rowClass} text-ink no-underline`}>
          {content}
        </Link>
      ) : (
        <Button onPress={onOpen} aria-haspopup="dialog" className={`group ${rowClass} cursor-pointer`}>
          {content}
        </Button>
      )}
    </li>
  )
}

/** Carried over from last Week, the sheet says until when; Key and Optional are already in its meta. */
function bucketLine({ week, carriedUntil }: BucketEntry): string | undefined {
  return carriedUntil ? `Week ${week}’s Key session, until ${shortWeekday(carriedUntil)}` : undefined
}
