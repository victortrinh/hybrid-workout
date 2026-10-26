import { useState } from 'react'
import { Button, Link } from 'react-aria-components'
import { addDays, daysBetween } from '../../domain/calendar'
import type { CoachDay } from '../../domain/coach'
import { isLive, type LiveSession } from '../../domain/lifts'
import { logFor, missingRequired, trained, type SessionLog } from '../../domain/log'
import { logSummary } from '../../domain/logSummary'
import { clock, type Environment, type RunContext } from '../../domain/paces'
import { describeSession, SESSION_TYPES } from '../../domain/program/describe'
import type { Program, Session, Week } from '../../domain/program/types'
import type { PainReport } from '../../domain/pain'
import type { PainSuggestion } from '../../domain/suggestion'
import type { WorkingWeights } from '../../domain/weights'
import { outsideWeekLine } from '../coachCopy'
import { lineAction, primaryAction } from '../components/actions'
import { LaneChip } from '../components/LaneChip'
import { Prescription } from '../components/Prescription'
import { PAIN_FREE, painSuggestionFor, type PainAtStart } from '../components/PainStep'
import { asksAtStart, StartStep } from '../components/StartStep'
import { longDay, nb, shortDay, STATUS_LABEL, weekRange } from '../format'
import { logPath, SCREEN_PATH, weekPath } from '../router'
import { weekMark } from './Plan'

const linkClass =
  'inline-flex min-h-11 items-center text-[15px] font-bold text-link underline decoration-2 underline-offset-4 hover:decoration-[3px]'

/**
 * One Week: its dates, Phase and marks, then every Session of the Bucket. A
 * logged Session leads with what was done; each Prescription is one tap away,
 * open from the start for the Session Up next or the one a link points at.
 * Outside the Week Today runs, each Session can be started or logged from
 * here, early or late; it still counts for this Week.
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
  onStart: (week: number, session: Session, pain: PainAtStart, environment: Environment | null) => void
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
  /** Early, or late while a required Session is still to log: whatever is done here today still counts for this Week. */
  const when = current
    ? null
    : daysBetween(day.today, week.startDate) > 0
      ? 'early'
      : daysBetween(sunday, day.today) > 0 && missingRequired(week, logs)
        ? 'late'
        : null
  /** The Session Today offers as Next, when it is one of this Week's: it gets the one cobalt Start. */
  const nextUp = day.bucket.find((e) => e.state === 'next' && e.week === week.number)?.session.id
  /** A link to `#session-<id>` opens that Session's Prescription. */
  const [linked] = useState(() => location.hash.replace(/^#session-/, ''))

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

      {current && (
        <p className="mt-4 text-body">
          This Week runs from{' '}
          <Link href={SCREEN_PATH.today} className={linkClass}>
            Today
          </Link>
          .
        </p>
      )}

      {when && <p className="mt-4 text-body">{nb(outsideWeekLine(when, week.number, week.startDate, sunday))}</p>}

      <p className="mt-1.5 text-body-quiet text-muted">
        {day.fiveKTest?.resultSeconds
          ? `Paces from the ${clock(day.fiveKTest.resultSeconds)} 5K test on ${shortDay(day.fiveKTest.date)}`
          : day.paces?.estimate
            ? `Estimated paces from your ${clock(day.paces.fromSeconds)} 5K estimate, until the first 5K test`
            : 'Runs go by RPE until the baseline 5K test sets the Training paces'}
      </p>

      {week.notes && (
        <ul className="mt-3 rounded-sm bg-sunk p-[18px] text-body">
          {week.notes.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      )}

      {week.sessions.map((session) => {
        const log = logFor(logs, week.number, session.id)
        return (
          <SessionDetail
            key={session.id}
            session={session}
            program={program}
            run={runContext(week.number, session)}
            weights={weights}
            log={log}
            open={session.id === nextUp || session.id === linked}
            withStatus={current}
            next={!current && session.id === nextUp}
          >
            {!current && (
              <SessionActions
                week={week.number}
                session={session}
                headingId={`session-${session.id}`}
                log={log}
                next={session.id === nextUp}
                live={live}
                asking={asking === session.id}
                refocus={dismissed === session.id}
                standing={day.pain?.report ?? null}
                painSuggestion={painSuggestionFor(day.suggestions, day.pain?.report ?? null)}
                onAsk={(ask) => {
                  setAsking(ask ? session.id : null)
                  setDismissed(ask ? null : session.id)
                }}
                environment={runContext(week.number, session).environment}
                onStart={(pain, environment) => {
                  setAsking(null)
                  onStart(week.number, session, pain, environment)
                }}
              />
            )}
          </SessionDetail>
        )
      })}

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
 * Start session and Log after for a Session of another Week. The Session Today
 * offers as Next gets Today's pair, a cobalt Start and a line Log after, so the
 * screen still has one answer; every other Start is a line button with Log
 * after as a link. Start asks the pain step first when pain stands, and Treadmill or outside for a run, as Today does; a trained
 * log leaves only Edit log. While a Live session runs, only its own Session
 * offers Resume.
 */
function SessionActions({
  week,
  session,
  headingId,
  log,
  next,
  live,
  asking,
  refocus,
  standing,
  painSuggestion,
  environment,
  onAsk,
  onStart,
}: {
  week: number
  session: Session
  /** The Session's heading: every action names the Session it acts on. */
  headingId: string
  log: SessionLog | null
  /** Today's Next Session: its Start is the primary action. */
  next: boolean
  live: LiveSession | null
  asking: boolean
  /** Back from Start's questions with "Not now": focus returns to Start session. */
  refocus: boolean
  /** The Pain report standing now: above 0, Start asks whether it still hurts. */
  standing: PainReport | null
  /** Its pain Suggestion: once decided, Same starts with that. */
  painSuggestion: PainSuggestion | null
  /** Where its runs happen as it stands: what Treadmill or outside comes chosen with. */
  environment: Environment
  onAsk: (asking: boolean) => void
  onStart: (pain: PainAtStart, environment: Environment | null) => void
}) {
  if (asking && !live) {
    return (
      <div className="mt-4 border-t-2 border-ink pt-3.5">
        <StartStep
          session={session}
          standing={standing}
          suggestion={painSuggestion}
          environment={environment}
          onStart={onStart}
          onCancel={() => onAsk(false)}
        />
      </div>
    )
  }
  const running = live !== null && live.week === week && live.sessionId === session.id
  const startable = isLive(session) && !(log && trained(log))
  const status = log ? `${STATUS_LABEL[log.status]}, ${shortDay(log.date)}` : null
  const statusId = `${headingId}-status`
  return (
    <div className="mt-4">
      {(status || (live && !running && startable)) && (
        <p id={statusId} className="text-body-quiet text-muted">
          {[status, live && !running && startable && nb(`${live.heading} is running. Finish it first.`)]
            .filter(Boolean)
            .join(' · ')}
        </p>
      )}
      <div className={`mt-2 flex flex-wrap items-center ${next ? 'gap-2.5' : 'gap-x-5 gap-y-1'}`}>
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
              onPress={() => (asksAtStart(session, standing) ? onAsk(true) : onStart({ ...PAIN_FREE }, null))}
              aria-describedby={headingId}
              className={next ? primaryAction : `${lineAction} flex-none`}
            >
              Start session
            </Button>
          )
        )}
        <Link
          href={logPath(week, session.id)}
          aria-describedby={status ? `${headingId} ${statusId}` : headingId}
          className={next ? `${lineAction} no-underline` : linkClass}
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
  log,
  open: openAtFirst,
  withStatus,
  next = false,
  children,
}: {
  session: Session
  program: Program
  run: RunContext
  weights?: WorkingWeights
  /** What was logged for it: a trained one leads with what was done. */
  log: SessionLog | null
  /** Its Prescription starts open: the Session Up next, or the one a link points at. */
  open: boolean
  /** Says the log's status and day too: no actions below do. */
  withStatus: boolean
  /** Today's Next Session, tagged as on Today's Week list. */
  next?: boolean
  /** What can be done with it: start or log it. */
  children?: React.ReactNode
}) {
  /** The athlete's own choice, once made; until then Up next can move as the day loads. */
  const [chosen, setChosen] = useState<boolean | null>(null)
  const open = chosen ?? openAtFirst
  const description = describeSession(session, run, weights)
  const headingId = `session-${session.id}`
  const prescriptionId = `${headingId}-prescription`
  const done = log && [
    withStatus && `${STATUS_LABEL[log.status]}, ${shortDay(log.date)}`,
    logSummary(log, session.type),
  ]
  const summary = done?.filter(Boolean).join(' · ')
  return (
    <section aria-labelledby={headingId} className="mt-section border-t-2 border-ink pt-3.5">
      <div className="grid grid-cols-[36px_1fr_auto] items-center gap-3">
        <LaneChip lane={SESSION_TYPES[session.type].lane} />
        <h2 id={headingId} className="scroll-mt-4 text-title">
          {nb(description.heading)}
        </h2>
        {next && <span className="rounded-sm bg-cobalt px-2 py-1 text-label text-on-cobalt">Next</span>}
      </div>
      <p className="mt-1.5 text-body-quiet text-muted">
        {[description.meta, session.date && longDay(session.date)].filter(Boolean).join(' · ')}
      </p>
      {summary && <p className="mt-1.5 text-body font-bold">{nb(summary)}</p>}
      {log?.notes && <p className="mt-1 text-body-quiet text-muted">{log.notes}</p>}
      {session.note && <p className="mt-1.5 text-body">{session.note}</p>}
      {children}

      <Button
        onPress={() => setChosen(!open)}
        aria-expanded={open}
        aria-controls={open ? prescriptionId : undefined}
        aria-describedby={headingId}
        className={`${linkClass} mt-1`}
      >
        {open ? 'Hide the Prescription' : 'Show the Prescription'}
      </Button>

      {open && (
        <Prescription id={prescriptionId} session={session} stations={program.stations} run={run} weights={weights} />
      )}
    </section>
  )
}
