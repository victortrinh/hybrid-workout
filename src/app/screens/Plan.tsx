import { useMemo } from 'react'
import { Link } from 'react-aria-components'
import type { CoachDay } from '../../domain/coach'
import type { SessionLog } from '../../domain/log'
import { SESSION_TYPES } from '../../domain/program/describe'
import type { Program, Week } from '../../domain/program/types'
import { weeklyCompletion, type WeekCompletion } from '../../domain/progress'
import { LaneLegend } from '../components/LaneChip'
import { completionLabel, WeekLanes } from '../components/WeekLanes'
import { longDay, shortDay } from '../format'
import { weekPath } from '../router'

/**
 * Plan: all 27 Weeks as five-lane rows, grouped by Phase. Each cell is one
 * Session of the Bucket in its Session type's colour; Key sessions stand
 * taller. Weeks so far fill in from the logs, the same as Weekly completion
 * on Progress; Weeks ahead stay outlined. Tapping a Week opens its Sessions.
 */
export function Plan({ program, day, logs }: { program: Program; day: CoachDay; logs: SessionLog[] }) {
  const current = day.position.kind === 'in-week' ? day.position.week : null
  const completion = useMemo(
    () => new Map(weeklyCompletion(program, logs, day.today).map((w) => [w.week, w])),
    [program, logs, day.today],
  )
  return (
    <div className="px-pad pt-6 desktop:max-w-plan desktop:px-gutter desktop:pt-9">
      <h1 tabIndex={-1} className="text-headline-page">
        Plan
      </h1>
      <p className="mt-1 text-body-quiet text-muted">
        {program.weekCount} Weeks to {longDay(program.raceDay)}. Tall lanes are Key sessions.
      </p>
      <LaneLegend />

      {program.phases.map((phase) => (
        <section key={phase.id} aria-labelledby={`phase-${phase.id}`}>
          <h2 id={`phase-${phase.id}`} className="mt-6 flex items-baseline justify-between gap-3 text-title-sm">
            {phase.name}
            <small className="text-[14px] font-medium tracking-normal text-muted font-stretch-100%">
              {phase.firstWeek === phase.lastWeek ? `Week ${phase.firstWeek}` : `Weeks ${phase.firstWeek}–${phase.lastWeek}`}
            </small>
          </h2>
          <ul className="mt-1.5">
            {phase.weeks.map((week) => (
              // The current Week is where Plan opens: the shell scrolls it into the thumb's reach.
              <li key={week.number} data-scroll-anchor={week.number === current ? '' : undefined}>
                <WeekRow week={week} current={week.number === current} completion={completion.get(week.number)} />
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  )
}

/** "Deload", "5K test", "Simulation", "Race", or nothing for an ordinary Week. */
export function weekMark(week: Week): string {
  if (week.race) return 'Race'
  if (week.deload) return 'Deload'
  if (week.fiveKTest) return '5K test'
  if (week.raceSimulation) return 'Simulation'
  return ''
}

function WeekRow({ week, current, completion }: { week: Week; current: boolean; completion?: WeekCompletion }) {
  const key = week.sessions.find((s) => s.key)
  const mark = weekMark(week)
  return (
    <Link
      href={weekPath(week.number)}
      aria-current={current ? 'date' : undefined}
      className={`grid min-h-11 grid-cols-[40px_1fr_88px] items-center gap-2.5 border-b border-rule px-1.5 py-[7px] text-ink no-underline hover:bg-sunk ${current ? 'bg-sunk' : ''}`}
    >
      <span aria-hidden="true" className={`font-extrabold font-stretch-125% ${current ? 'text-link' : ''}`}>
        {String(week.number).padStart(2, '0')}
      </span>
      <span className="sr-only">
        Week {week.number}, from {shortDay(week.startDate)}
        {current && ', this Week'}
        {key && `, Key session ${SESSION_TYPES[key.type].name}`}
        {completion && `, ${completionLabel(completion)}`}
        {mark && ', '}
      </span>
      <WeekLanes cells={completion?.cells ?? week.sessions.map((session) => ({ session }))} />
      <span className="text-right text-label text-muted">{mark}</span>
    </Link>
  )
}
