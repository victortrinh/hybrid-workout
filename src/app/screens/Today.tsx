import { Button, Link } from 'react-aria-components'
import { addDays } from '../../domain/calendar'
import type { BucketEntry, CoachDay, PhaseProgress, RestReason } from '../../domain/coach'
import { isLiveRun, type LiveRun } from '../../domain/live'
import type { Environment, RunContext } from '../../domain/paces'
import { describeSession, SESSION_TYPES } from '../../domain/program/describe'
import type { Session } from '../../domain/program/types'
import type { Settings } from '../../domain/settings'
import type { Decision, Suggestion } from '../../domain/suggestion'
import { suggestionCopy } from '../coachCopy'
import { FieldLane } from '../components/FieldLane'
import { LaneChip } from '../components/LaneChip'
import { Segmented } from '../components/Segmented'
import { SettingsPopover } from '../components/SettingsPopover'
import { StripedNumeral } from '../components/StripedNumeral'
import { longDay, nb, plural, shortDay, shortWeekday, STATUS_LABEL, weekday, weekRange } from '../format'
import { logPath, SCREEN_PATH } from '../router'

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
  onDecide,
  live,
  onStart,
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
  /** The Live session running on this device, if any. */
  live: LiveRun | null
  /** Start session: opens a Live session of Up next. */
  onStart: (week: number, session: Session) => void
}) {
  return (
    <section
      aria-labelledby="today-heading"
      className="desktop:grid desktop:grid-cols-2 desktop:gap-x-12 desktop:px-gutter"
    >
      <FieldBand day={day} weekCount={weekCount} settings={settings} onSettings={onSettings} />
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
      />
      <ThisWeek day={day} onPick={onPick} />
    </section>
  )
}

function FieldBand({
  day,
  weekCount,
  settings,
  onSettings,
}: {
  day: CoachDay
  weekCount: number
  settings: Settings
  onSettings: (patch: Partial<Settings>) => void
}) {
  const { position } = day
  return (
    <header className="on-field bg-cobalt px-pad pt-4 pb-5 text-on-cobalt desktop:col-span-full desktop:-mx-gutter desktop:grid desktop:grid-cols-[auto_minmax(0,1fr)] desktop:items-end desktop:gap-x-14 desktop:gap-y-2 desktop:px-gutter desktop:py-7">
      <div className="flex items-center justify-between gap-3 desktop:col-span-full desktop:justify-end">
        <span className="text-brand uppercase font-stretch-125% desktop:hidden">Compromised</span>
        {/* The athlete's initial opens Settings. */}
        <SettingsPopover settings={settings} onChange={onSettings} />
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
}: {
  day: CoachDay
  weekCount: number
  pending: number
  error: string | null
  onDecide: (suggestion: Suggestion, decision: Decision) => void
  runContext: (week: number, session: Session) => RunContext
  onEnvironment: (week: number, session: Session, environment: Environment) => void
  live: LiveRun | null
  onStart: (week: number, session: Session) => void
}) {
  const { position, upNext } = day
  const upNextWeek = day.bucket.find((e) => e.state === 'next')?.week
  const run = upNext && upNextWeek ? runContext(upNextWeek, upNext) : undefined
  let heading: string
  let target: string
  let meta = ''

  if (upNext) {
    const description = describeSession(upNext, run)
    heading = description.heading
    target = description.target
    meta = description.meta
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
    ;({ heading, target, meta } = restCopy(day.rest, position.week, position.endDate, weekCount))
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
      {live ? (
        <div className="mt-4 flex gap-2.5">
          <Link href={SCREEN_PATH.live} className={`${primaryAction} no-underline`}>
            Resume {nb(live.heading)}
          </Link>
        </div>
      ) : upNext && upNextWeek && position.kind === 'in-week' && (
        <div className="mt-4 flex gap-2.5">
          {isLiveRun(upNext) && (
            <Button onPress={() => onStart(upNextWeek, upNext)} className={primaryAction}>
              Start session
            </Button>
          )}
          <Link
            href={logPath(upNextWeek, upNext.id)}
            className="inline-grid min-h-[54px] flex-1 place-items-center rounded-sm px-5 text-[17px] font-bold text-ink no-underline shadow-[inset_0_0_0_2px_var(--ink)] hover:bg-sunk desktop:flex-none"
          >
            Log after
          </Link>
        </div>
      )}
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
    </div>
  )
}

const primaryAction =
  'inline-grid min-h-[54px] flex-1 cursor-pointer place-items-center rounded-sm bg-cobalt px-5 text-center text-[17px] font-bold text-on-cobalt hover:bg-cobalt-hover data-focus-visible:outline-3 data-focus-visible:outline-offset-2 data-focus-visible:outline-link desktop:flex-none'

/** Whether the Session's target reads differently indoors and out: it has a run at a Training pace. */
function dependsOnEnvironment(session: Session, run: RunContext): boolean {
  const indoor = describeSession(session, { ...run, environment: 'indoor' }).target
  return indoor !== describeSession(session, { ...run, environment: 'outdoor' }).target
}

const buttonBase =
  'cursor-pointer py-2 text-[15px] font-bold data-focus-visible:outline-3 data-focus-visible:outline-offset-2 data-focus-visible:outline-link'
/** The prototype's link buttons: Accept in link blue, underlined; Keep and Undo quiet, in ink. */
const linkButton = `${buttonBase} text-link underline decoration-2 underline-offset-4 hover:decoration-[3px]`
const quietButton = `${buttonBase} text-ink hover:underline hover:decoration-2 hover:underline-offset-4`

/** The Coach's Suggestion between ink rules: the line, the facts, then Accept and Keep (or Undo). */
function SuggestionNote({ suggestion, onDecide }: { suggestion: Suggestion; onDecide: (d: Decision) => void }) {
  const copy = suggestionCopy(suggestion)
  const { decision } = suggestion
  return (
    <section
      aria-label="Coach’s Suggestion"
      aria-live="polite"
      className="mt-[18px] border-t-2 border-b border-t-ink border-b-rule py-3.5"
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

/** Blunt, with the reason first (PRODUCT.md, Coach voice). */
function restCopy(
  rest: RestReason,
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
        target: `${describeSession(rest.session).heading} is ${weekday(rest.date)}. Save it for that.`,
        meta: longDay(rest.date),
      }
  }
}

function ThisWeek({ day, onPick }: { day: CoachDay; onPick: (week: number, sessionId: string) => void }) {
  const { week, position, bucket } = day
  if (!week) return null

  const inWeek = position.kind === 'in-week'
  const left = bucket.filter((e) => !e.session.optional && !e.log).length
  const aside = inWeek
    ? `${plural(left, 'Session')} left · ${plural(position.daysLeft, 'day')}`
    : `from ${shortDay(week.startDate)}`

  return (
    <div className="px-pad desktop:px-0 desktop:pt-7">
      <h2 className="mt-[22px] flex items-baseline justify-between gap-3 text-title">
        {inWeek ? 'This Week' : `Week ${week.number}`}
        <small className="text-[14px] font-medium tracking-normal text-muted font-stretch-100%">{aside}</small>
      </h2>
      <ul className="mt-1.5">
        {bucket.map((entry) => (
          <BucketRow
            key={`${entry.week}/${entry.session.id}`}
            entry={entry}
            interactive={inWeek}
            onPick={() => onPick(entry.week, entry.session.id)}
          />
        ))}
      </ul>
      {inWeek && left > 0 && <p className="mt-2.5 text-[14px] text-muted">Tap any Session to do it today instead.</p>}
    </div>
  )
}

const rowClass = 'grid w-full grid-cols-[36px_1fr_auto] items-center gap-3 py-[11px] text-left'

/**
 * One Session of the Bucket. Planned rows are buttons that make the Session
 * today's; logged rows link to their log; Up next is plain, it's already today's.
 */
function BucketRow({
  entry,
  interactive,
  onPick,
}: {
  entry: BucketEntry
  interactive: boolean
  onPick: () => void
}) {
  const { session, state, log, week, carriedUntil } = entry
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
