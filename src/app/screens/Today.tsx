import { Button, Link } from 'react-aria-components'
import { addDays } from '../../domain/calendar'
import type { BucketEntry, CoachDay, PhaseProgress, RestReason } from '../../domain/coach'
import { describeSession, SESSION_TYPES } from '../../domain/program/describe'
import { FieldLane } from '../components/FieldLane'
import { LaneChip } from '../components/LaneChip'
import { StripedNumeral } from '../components/StripedNumeral'
import { longDay, nb, plural, shortDay, shortWeekday, STATUS_LABEL, weekday, weekRange } from '../format'
import { logPath } from '../router'

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
}: {
  day: CoachDay
  weekCount: number
  /** Logs saved on this device that the server hasn't taken yet. */
  pending: number
  /** A log the server refused or the device couldn't store, said once under Up next. */
  error: string | null
  /** Makes a Session of the Bucket today's Session instead of Up next. */
  onPick: (sessionId: string) => void
}) {
  return (
    <section
      aria-labelledby="today-heading"
      className="desktop:grid desktop:grid-cols-2 desktop:gap-x-12 desktop:px-gutter"
    >
      <FieldBand day={day} weekCount={weekCount} />
      <UpNext day={day} weekCount={weekCount} pending={pending} error={error} />
      <ThisWeek day={day} onPick={onPick} />
    </section>
  )
}

function FieldBand({ day, weekCount }: { day: CoachDay; weekCount: number }) {
  const { position } = day
  return (
    <header className="on-field bg-cobalt px-pad pt-4 pb-5 text-on-cobalt desktop:col-span-full desktop:-mx-gutter desktop:grid desktop:grid-cols-[auto_minmax(0,1fr)] desktop:items-end desktop:gap-x-14 desktop:gap-y-2 desktop:px-gutter desktop:py-7">
      <div className="flex items-center justify-between gap-3 desktop:col-span-full desktop:justify-end">
        <span className="text-brand uppercase font-stretch-125% desktop:hidden">Compromised</span>
        {/* The athlete's initial. Settings will open from here. */}
        <span
          aria-hidden="true"
          className="grid size-10 place-items-center rounded-full bg-on-cobalt font-extrabold text-cobalt"
        >
          V
        </span>
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
}: {
  day: CoachDay
  weekCount: number
  pending: number
  error: string | null
}) {
  const { position, upNext, week } = day
  let heading: string
  let target: string
  let meta = ''

  if (upNext) {
    const description = describeSession(upNext)
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
      {upNext && week && position.kind === 'in-week' && (
        <div className="mt-4 flex gap-2.5">
          <Link
            href={logPath(week.number, upNext.id)}
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
    </div>
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

function ThisWeek({ day, onPick }: { day: CoachDay; onPick: (sessionId: string) => void }) {
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
            key={entry.session.id}
            entry={entry}
            week={week.number}
            interactive={inWeek}
            onPick={() => onPick(entry.session.id)}
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
  week,
  interactive,
  onPick,
}: {
  entry: BucketEntry
  week: number
  interactive: boolean
  onPick: () => void
}) {
  const { session, state, log } = entry
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
        <span className="text-[14px] text-muted">{nb(describeSession(session).summary)}</span>
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
