import { Link } from 'react-aria-components'
import { addDays } from '../../domain/calendar'
import type { CoachDay } from '../../domain/coach'
import { clock, type RunContext } from '../../domain/paces'
import { describeExercise, describeSession, SESSION_TYPES } from '../../domain/program/describe'
import type { Program, Session, Week } from '../../domain/program/types'
import { LaneChip } from '../components/LaneChip'
import { longDay, nb, shortDay, weekRange } from '../format'
import { SCREEN_PATH, weekPath } from '../router'
import { weekMark } from './Plan'

const linkClass =
  'inline-block py-2 text-[15px] font-bold text-link underline decoration-2 underline-offset-4 hover:decoration-[3px]'

/** One Week: its dates, Phase and marks, then every Session of the Bucket with its Prescriptions. */
export function WeekScreen({
  program,
  week,
  day,
  runContext,
}: {
  program: Program
  week: Week
  day: CoachDay
  /** How each Session's runs read: exact speeds or paces once there is a 5K test. */
  runContext: (week: Week, session: Session) => RunContext
}) {
  const phase = program.phases.find((p) => week.number >= p.firstWeek && week.number <= p.lastWeek)
  const current = day.position.kind === 'in-week' && day.position.week === week.number
  const mark = weekMark(week)
  const previous = week.number > 1 ? week.number - 1 : null
  const next = week.number < program.weekCount ? week.number + 1 : null

  return (
    <div className="px-pad pt-4 desktop:max-w-plan desktop:px-gutter desktop:pt-7">
      <Link href={SCREEN_PATH.plan} className={linkClass}>
        ← Plan
      </Link>
      <h1 tabIndex={-1} className="mt-2 text-headline-page">
        Week {week.number}
      </h1>
      <p className="mt-1 text-body-quiet text-muted">
        {[weekRange(week.startDate, addDays(week.startDate, 6)), phase?.name, mark, current && 'This Week']
          .filter(Boolean)
          .join(' · ')}
      </p>

      <p className="mt-1 text-body-quiet text-muted">
        {day.fiveKTest?.resultSeconds
          ? `Paces from the ${clock(day.fiveKTest.resultSeconds)} 5K test on ${shortDay(day.fiveKTest.date)}`
          : 'Runs go by RPE until the baseline 5K test sets the Training paces'}
      </p>

      {week.notes && (
        <ul className="mt-3 rounded-sm bg-sunk p-[18px] text-body">
          {week.notes.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      )}

      {week.sessions.map((session) => (
        <SessionDetail key={session.id} session={session} program={program} run={runContext(week, session)} />
      ))}

      <nav aria-label="Other Weeks" className="mt-8 flex justify-between gap-3 border-t-2 border-ink pt-2">
        {previous ? (
          <Link href={weekPath(previous)} className={linkClass}>
            ← Week {previous}
          </Link>
        ) : (
          <span />
        )}
        {next && (
          <Link href={weekPath(next)} className={linkClass}>
            Week {next} →
          </Link>
        )}
      </nav>
    </div>
  )
}

function SessionDetail({ session, program, run }: { session: Session; program: Program; run: RunContext }) {
  const description = describeSession(session, run)
  const headingId = `session-${session.id}`
  return (
    <section aria-labelledby={headingId} className="mt-7 border-t-2 border-ink pt-3">
      <div className="grid grid-cols-[36px_1fr] items-center gap-3">
        <LaneChip lane={SESSION_TYPES[session.type].lane} />
        <h2 id={headingId} className="text-title">
          {nb(description.heading)}
        </h2>
      </div>
      <p className="mt-1.5 text-body-quiet text-muted">
        {[description.meta, session.date && longDay(session.date)].filter(Boolean).join(' · ')}
      </p>
      {session.note && <p className="mt-1.5 text-body">{session.note}</p>}

      {session.blocks.map((block, i) => (
        <div key={`${block.name}-${i}`} className="mt-4">
          <h3 className="flex items-baseline justify-between gap-3 text-[18px]">
            {block.name}
            {block.minutes !== undefined && (
              <small className="text-[14px] font-medium tracking-normal text-muted font-stretch-100%">
                {block.minutes} min
              </small>
            )}
          </h3>
          <ul className="mt-1">
            {block.exercises.map((exercise, j) => {
              const line = describeExercise(exercise, program.stations, run)
              return (
                <li key={`${exercise.name}-${j}`} className="border-b border-rule py-2">
                  <span className="block text-[16px] font-bold">
                    {line.name}
                    {line.detail && <span className="font-semibold"> · {nb(line.detail)}</span>}
                  </span>
                  {line.note && <span className="block text-[14px] text-muted">{line.note}</span>}
                  {line.substitutions.map((sub) => (
                    <span key={sub} className="block text-[14px] text-muted">
                      Instead, if {sub.charAt(0).toLowerCase()}
                      {sub.slice(1)}
                    </span>
                  ))}
                </li>
              )
            })}
          </ul>
        </div>
      ))}
    </section>
  )
}
