import { useState } from 'react'
import { Button, Link } from 'react-aria-components'
import { addDays, daysBetween } from '../../domain/calendar'
import type { CoachDay } from '../../domain/coach'
import { isLive, type LiveSession } from '../../domain/lifts'
import { logFor, trained, type SessionLog } from '../../domain/log'
import { clock, type RunContext } from '../../domain/paces'
import { describeExercise, describeSession, SESSION_TYPES } from '../../domain/program/describe'
import type { Program, Session, Week } from '../../domain/program/types'
import type { WorkingWeights } from '../../domain/weights'
import { outsideWeekLine } from '../coachCopy'
import { lineAction, primaryAction } from '../components/actions'
import { LaneChip } from '../components/LaneChip'
import { PainStep, type PainAtStart } from '../components/PainStep'
import { longDay, nb, shortDay, STATUS_LABEL, weekRange } from '../format'
import { logPath, SCREEN_PATH, weekPath } from '../router'
import { weekMark } from './Plan'

const linkClass =
  'inline-block py-2 text-[15px] font-bold text-link underline decoration-2 underline-offset-4 hover:decoration-[3px]'

/**
 * One Week: its dates, Phase and marks, then every Session of the Bucket with
 * its Prescriptions. Outside the Week Today runs, each Session can be started
 * or logged from here, early or late; it still counts for this Week.
 */
export function WeekScreen({
  program,
  week,
  day,
  runContext,
  logs,
  live,
  onStart,
}: {
  program: Program
  week: Week
  day: CoachDay
  /** How each Session's runs read: exact speeds or paces once there is a 5K test. */
  runContext: (week: number, session: Session) => RunContext
  logs: SessionLog[]
  live: LiveSession | null
  onStart: (week: number, session: Session, pain: PainAtStart) => void
}) {
  const [asking, setAsking] = useState<string | null>(null)
  /** The Session whose pain step was just dismissed, to put focus back on its Start. */
  const [dismissed, setDismissed] = useState<string | null>(null)
  const phase = program.phases.find((p) => week.number >= p.firstWeek && week.number <= p.lastWeek)
  const current = day.position.kind === 'in-week' && day.position.week === week.number
  const mark = weekMark(week)
  const previous = week.number > 1 ? week.number - 1 : null
  const next = week.number < program.weekCount ? week.number + 1 : null
  // Loads from today's Working weights, for this Week and later ones: a past Week's are in its logs.
  const past = day.position.kind === 'finished' || (day.position.kind === 'in-week' && week.number < day.position.week)
  const weights = past ? undefined : day.workingWeights
  const sunday = addDays(week.startDate, 6)
  /** Early or late: whatever is done here today still counts for this Week. */
  const when = current ? null : daysBetween(day.today, week.startDate) > 0 ? 'early' : daysBetween(sunday, day.today) > 0 ? 'late' : null

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

      {when && <p className="mt-2 text-body">{nb(outsideWeekLine(when, week.number, week.startDate, sunday))}</p>}

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
        <SessionDetail
          key={session.id}
          session={session}
          program={program}
          run={runContext(week.number, session)}
          weights={weights}
        >
          {current ? (
            <p className="mt-3 text-body-quiet text-muted">
              This Week runs from{' '}
              <Link href={SCREEN_PATH.today} className={linkClass}>
                Today
              </Link>
              .
            </p>
          ) : (
            <SessionActions
              week={week.number}
              session={session}
              headingId={`session-${session.id}`}
              log={logFor(logs, week.number, session.id)}
              live={live}
              asking={asking === session.id}
              refocus={dismissed === session.id}
              previousPain={day.pain?.report.score ?? null}
              onAsk={(ask) => {
                setAsking(ask ? session.id : null)
                setDismissed(ask ? null : session.id)
              }}
              onStart={(pain) => {
                setAsking(null)
                onStart(week.number, session, pain)
              }}
            />
          )}
        </SessionDetail>
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

/**
 * Start session and Log after for a Session of another Week. Start is a line
 * button, not cobalt: a Week has no single answer, Today does. Start asks the
 * pain step first, as Today does; a trained log leaves only Edit log. While
 * a Live session runs, only its own Session offers Resume.
 */
function SessionActions({
  week,
  session,
  headingId,
  log,
  live,
  asking,
  refocus,
  previousPain,
  onAsk,
  onStart,
}: {
  week: number
  session: Session
  /** The Session's heading: every action names the Session it acts on. */
  headingId: string
  log: SessionLog | null
  live: LiveSession | null
  asking: boolean
  /** Back from the pain step with "Not now": focus returns to Start session. */
  refocus: boolean
  previousPain: number | null
  onAsk: (asking: boolean) => void
  onStart: (pain: PainAtStart) => void
}) {
  if (asking && !live) return <PainStep previous={previousPain} onAnswer={onStart} onCancel={() => onAsk(false)} />
  const running = live !== null && live.week === week && live.sessionId === session.id
  const startable = isLive(session) && !(log && trained(log))
  const status = log ? `${STATUS_LABEL[log.status]}, ${shortDay(log.date)}` : null
  const statusId = `${headingId}-status`
  return (
    <div className="mt-3">
      {(status || (live && !running && startable)) && (
        <p id={statusId} className="text-body-quiet text-muted">
          {[status, live && !running && startable && nb(`${live.heading} is running. Finish it first.`)]
            .filter(Boolean)
            .join(' · ')}
        </p>
      )}
      <div className="mt-2 flex flex-wrap items-center gap-x-5 gap-y-1">
        {running ? (
          <Link
            href={SCREEN_PATH.live}
            aria-describedby={headingId}
            className={`${primaryAction} no-underline desktop:flex-none`}
          >
            Resume
          </Link>
        ) : (
          startable &&
          !live && (
            <Button
              autoFocus={refocus}
              onPress={() => onAsk(true)}
              aria-describedby={headingId}
              className={`${lineAction} flex-none`}
            >
              Start session
            </Button>
          )
        )}
        <Link
          href={logPath(week, session.id)}
          aria-describedby={status ? `${headingId} ${statusId}` : headingId}
          className={linkClass}
        >
          {log ? 'Edit log' : 'Log after'}
        </Link>
      </div>
    </div>
  )
}

function SessionDetail({
  session,
  program,
  run,
  weights,
  children,
}: {
  session: Session
  program: Program
  run: RunContext
  weights?: WorkingWeights
  /** What can be done with it: start or log it, or where to from. */
  children?: React.ReactNode
}) {
  const description = describeSession(session, run, weights)
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
      {children}

      {session.blocks.map((block, i) => (
        <div key={`${block.name}-${i}`} className="mt-4">
          <h3 className="flex items-baseline justify-between gap-3 text-title-sm">
            {block.name}
            {block.minutes !== undefined && (
              <small className="text-body-quiet tracking-normal text-muted font-stretch-100%">
                {block.minutes} min
              </small>
            )}
          </h3>
          <ul className="mt-1">
            {block.exercises.map((exercise, j) => {
              const line = describeExercise(exercise, program.stations, run, weights)
              return (
                <li key={`${exercise.name}-${j}`} className="border-b border-rule py-2">
                  <span className="block text-body font-bold">
                    {line.name}
                    {line.detail && <span className="font-semibold"> · {nb(line.detail)}</span>}
                  </span>
                  {line.note && <span className="block text-body-quiet text-muted">{line.note}</span>}
                  {line.substitutions.map((sub) => (
                    <span key={sub} className="block text-body-quiet text-muted">
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
