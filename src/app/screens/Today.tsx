import type { CoachDay, PhaseProgress } from '../../domain/coach'
import { describeSession, SESSION_TYPES } from '../../domain/program/describe'
import type { Session } from '../../domain/program/types'
import { FieldLane } from '../components/FieldLane'
import { LaneChip } from '../components/LaneChip'
import { StripedNumeral } from '../components/StripedNumeral'
import { longDay, nb, plural, shortDay, weekday, weekRange } from '../format'

/**
 * Today: one number (days to the race), one instruction (Up next), then the
 * Week's Bucket as rows. On desktop the cobalt band runs full width with the
 * countdown and Phase lanes side by side, then two equal columns.
 */
export function Today({ day, weekCount }: { day: CoachDay; weekCount: number }) {
  return (
    <section
      aria-labelledby="today-heading"
      className="desktop:grid desktop:grid-cols-2 desktop:gap-x-12 desktop:px-gutter"
    >
      <FieldBand day={day} weekCount={weekCount} />
      <UpNext day={day} />
      <ThisWeek day={day} />
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

function UpNext({ day }: { day: CoachDay }) {
  const { position, upNext } = day
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
    </div>
  )
}

function ThisWeek({ day }: { day: CoachDay }) {
  const { week, position } = day
  if (!week) return null

  const planned = week.sessions.filter((s) => !s.optional).length
  const aside =
    position.kind === 'in-week'
      ? `${plural(planned, 'Session')} · ${plural(position.daysLeft, 'day')} left`
      : `from ${shortDay(week.startDate)}`

  return (
    <div className="px-pad desktop:px-0 desktop:pt-7">
      <h2 className="mt-[22px] flex items-baseline justify-between gap-3 text-title">
        {position.kind === 'in-week' ? 'This Week' : `Week ${week.number}`}
        <small className="text-[14px] font-medium tracking-normal text-muted font-stretch-100%">{aside}</small>
      </h2>
      <ul className="mt-1.5">
        {week.sessions.map((session) => (
          <BucketRow key={session.id} session={session} next={session === day.upNext} />
        ))}
      </ul>
    </div>
  )
}

function BucketRow({ session, next }: { session: Session; next: boolean }) {
  const type = SESSION_TYPES[session.type]
  return (
    <li className="grid grid-cols-[36px_1fr_auto] items-center gap-3 border-b border-rule py-[11px]">
      <LaneChip lane={type.lane} />
      <span>
        <span className="block text-[17px] font-bold">{type.name}</span>
        <span className="text-[14px] text-muted">{nb(describeSession(session).summary)}</span>
      </span>
      <span className="text-[14px] font-bold">
        {next ? (
          <span className="inline-block rounded-sm bg-cobalt px-2 py-1 text-label text-on-cobalt">Next</span>
        ) : session.optional ? (
          'Optional'
        ) : session.key ? (
          'Key'
        ) : null}
      </span>
    </li>
  )
}
