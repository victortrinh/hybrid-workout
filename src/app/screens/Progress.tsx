import { Link } from 'react-aria-components'
import { useMemo, type ReactNode } from 'react'
import type { LocalDate } from '../../domain/calendar'
import type { CoachDay } from '../../domain/coach'
import type { SessionLog } from '../../domain/log'
import { clock, GOAL_PACE, speedFor, UNIT_LABEL, type SpeedUnit, type TrainingPaces } from '../../domain/paces'
import { stations as STATIONS } from '../../domain/program/program'
import { LIFT_NAME } from '../../domain/program/describe'
import type { Lane, Program, Station } from '../../domain/program/types'
import {
  GOAL_SECONDS,
  plannedAt,
  progress,
  recoveryTrend,
  RECOVERY_NIGHTS,
  stationTimes,
  workingWeightRows,
  type FiveKProgress,
  type StationTimes,
  type WeekCompletion,
  type WeekLoad,
  type WorkingWeightRow,
} from '../../domain/progress'
import { isShortSleep, sleepText, SHORT_SLEEP_MINUTES, type RecoveryNight } from '../../domain/recovery'
import type { WorkingWeightChange } from '../../domain/weights'
import { EmptyState } from '../components/EmptyState'
import { LANES, LaneLegend } from '../components/LaneChip'
import { completionLabel, WeekLanes } from '../components/WeekLanes'
import { nb, shortDay } from '../format'
import { weekPath } from '../router'
import { useWidth } from '../useWidth'
import { weekMark } from './Plan'

interface ProgressProps {
  program: Program
  day: CoachDay
  logs: SessionLog[]
  recoveryNights: RecoveryNight[]
  unit: SpeedUnit
}

/**
 * Progress: whether the Program is working. 5K tests against the planned line
 * to 20:00, each Week's completion by Session type, Training load per Week,
 * the current Training paces, recent recovery, the Working weights and HYROX
 * Station times. Twelve columns on desktop, stacked on a phone.
 */
export function Progress({ program, day, logs, recoveryNights, unit }: ProgressProps) {
  const data = useMemo(() => progress(program, logs, day.today), [program, logs, day.today])
  const stations = useMemo(() => stationTimes(program, logs, day.today), [program, logs, day.today])
  const firstTest = program.phases.flatMap((p) => p.weeks).find((w) => w.fiveKTest)

  return (
    <div className="px-pad pt-6 desktop:max-w-progress desktop:px-gutter desktop:pt-9">
      <h1 tabIndex={-1} className="text-headline-page">
        Progress
      </h1>
      <p className="mt-1 text-body-quiet text-muted">5K tests against 20:00, weekly completion, Training load and paces.</p>
      {logs.length === 0 && recoveryNights.length === 0 ? (
        <EmptyState title="Nothing logged yet, so nothing to chart.">
          {firstTest
            ? `The baseline 5K test is Week ${firstTest.number}. The 20:00 line can wait until then.`
            : 'Charts start with the first Session log.'}
        </EmptyState>
      ) : (
        <div className="mt-3.5 grid gap-x-10 desktop:grid-cols-12">
          <FiveKPanel program={program} fiveK={data.fiveK} firstTestWeek={firstTest?.number ?? null} />
          <CompletionPanel program={program} day={day} completion={data.completion} />
          <LoadPanel program={program} load={data.load} />
          <PacesPanel paces={day.paces} fiveKTest={day.fiveKTest} unit={unit} firstTestWeek={firstTest?.number ?? null} />
          <RecoveryPanel nights={recoveryNights} today={day.today} />
          <WeightsPanel program={program} changes={day.workingWeightChanges} />
          <StationsPanel times={stations} />
        </div>
      )}
    </div>
  )
}

const SPAN = { 4: 'desktop:col-span-4', 6: 'desktop:col-span-6', 8: 'desktop:col-span-8', 12: 'desktop:col-span-12' }

function Panel({
  title,
  sub,
  span,
  children,
}: {
  title: string
  sub: ReactNode
  span: keyof typeof SPAN
  children: ReactNode
}) {
  const id = `panel-${title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`
  return (
    <section aria-labelledby={id} className={`min-w-0 border-t-2 border-ink pt-3.5 pb-6 ${SPAN[span]}`}>
      <h2 id={id} className="text-title">
        {title}
      </h2>
      <p className="mt-1 text-body-quiet text-muted">{sub}</p>
      {children}
    </section>
  )
}

/** Draws `render` at the slot's measured width, once there is one. */
function ChartSlot({ render }: { render: (width: number) => ReactNode }) {
  const [ref, width] = useWidth<HTMLDivElement>()
  return (
    <div ref={ref} className="mt-3 min-h-[120px]">
      {width > 0 && render(width)}
    </div>
  )
}

/** Every other tick where the chart is narrow, so the labels don't touch. */
const ticks = (width: number, all: number[]) => (width < 480 ? all.filter((_, i) => i % 2 === 0) : all)

// ---------------------------------------------------------------------------
// 5K vs. sub-20

const ENVIRONMENT_WORD = { indoor: 'treadmill', outdoor: 'outdoors' } as const

function FiveKPanel({
  program,
  fiveK,
  firstTestWeek,
}: {
  program: Program
  fiveK: FiveKProgress
  firstTestWeek: number | null
}) {
  const latest = fiveK.tests.at(-1)
  const sub = !latest
    ? `No 5K test yet.${firstTestWeek ? ` The baseline is Week ${firstTestWeek}.` : ''}`
    : `${fiveK.tests.length === 1 ? 'One test so far' : `${fiveK.tests.length} tests so far`}: latest ${clock(latest.seconds)}${latest.environment ? ` ${latest.environment === 'indoor' ? 'on a treadmill' : 'outdoors'}` : ''}, Week ${latest.week}. ${toFind(latest.seconds, fiveK)}`
  return (
    <Panel title="5K vs. sub-20" sub={sub} span={8}>
      {latest ? (
        <>
          <ChartSlot render={(width) => <FiveKChart width={width} weekCount={program.weekCount} fiveK={fiveK} />} />
          <ul aria-label="Chart key" className="mt-3 flex flex-wrap gap-x-3.5 gap-y-1.5 text-label text-muted">
            <li className="flex items-center gap-1.5">
              <i aria-hidden="true" className="inline-block size-2.5 bg-link" />
              Treadmill test
            </li>
            <li className="flex items-center gap-1.5">
              <i aria-hidden="true" className="inline-block size-2.5 rounded-full bg-link" />
              Outdoor test
            </li>
            {fiveK.planned && (
              <li className="flex items-center gap-1.5">
                <i aria-hidden="true" className="inline-block size-2.5 border-2 border-link" />
                Planned test
              </li>
            )}
          </ul>
        </>
      ) : (
        <EmptyState title="The 20:00 line can wait until the baseline.">
          The baseline test sets the Training paces and the planned line to sub-20.
        </EmptyState>
      )}
    </Panel>
  )
}

function toFind(seconds: number, fiveK: FiveKProgress): string {
  const gap = seconds - GOAL_SECONDS
  if (gap <= 0) return 'Under 20:00.'
  const by = fiveK.planned ? ` by Week ${fiveK.planned.to.week}` : ''
  return `${clock(gap)} to find${by}.`
}

function FiveKChart({ width: W, weekCount, fiveK }: { width: number; weekCount: number; fiveK: FiveKProgress }) {
  const H = 230
  const [L, R, T, B] = [48, 16, 18, 30]
  const times = [...fiveK.tests.map((t) => t.seconds), GOAL_SECONDS]
  const low = Math.min(19, Math.floor(Math.min(...times) / 60))
  const high = Math.max(25, Math.ceil(Math.max(...times) / 60))
  const x = (week: number) => L + ((week - 1) / (weekCount - 1)) * (W - L - R)
  const y = (seconds: number) => T + ((seconds - low * 60) / ((high - low) * 60)) * (H - T - B)
  const minutes = Array.from({ length: high - low + 1 }, (_, i) => low + i)
  const latest = fiveK.tests.at(-1)!
  const path = fiveK.tests.map((t, i) => `${i ? 'L' : 'M'}${x(t.week)},${y(t.seconds)}`).join('')
  const midWeek = fiveK.planned ? (fiveK.planned.from.week + fiveK.planned.to.week) / 2 : null
  // The latest test's label sits right of its mark, or left of it near the end.
  const labelRight = x(latest.week) < W - R - 140

  return (
    <svg className="chart" width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={fiveKSummary(fiveK)}>
      {minutes.map((m) => (
        <g key={m}>
          <text x={L - 10} y={y(m * 60) + 4} textAnchor="end">
            {m}:00
          </text>
          <line x1={L} x2={W - R} y1={y(m * 60)} y2={y(m * 60)} stroke="var(--rule)" />
        </g>
      ))}
      {ticks(W, [1, 5, 9, 13, 17, 21, 25].filter((w) => w <= weekCount)).map((w) => (
        <text key={w} x={x(w)} y={H - 6} textAnchor="middle">
          W{w}
        </text>
      ))}
      <line x1={L} x2={W - R} y1={y(GOAL_SECONDS)} y2={y(GOAL_SECONDS)} stroke="var(--speed)" strokeWidth={2} />
      <text x={L + 6} y={y(GOAL_SECONDS) - 8} className="goal">
        Goal 20:00
      </text>
      {fiveK.planned && midWeek !== null && (
        <>
          <line
            x1={x(fiveK.planned.from.week)}
            y1={y(fiveK.planned.from.seconds)}
            x2={x(fiveK.planned.to.week)}
            y2={y(fiveK.planned.to.seconds)}
            stroke="var(--link)"
            strokeWidth={2}
            strokeDasharray="6 6"
          />
          <text x={x(midWeek)} y={y(plannedAt(fiveK.planned, midWeek)) + 20} textAnchor="middle">
            Plan
          </text>
        </>
      )}
      {fiveK.upcoming.map(
        (u) =>
          u.seconds !== null && (
            <rect
              key={u.week}
              x={x(u.week) - 6}
              y={y(u.seconds) - 6}
              width={12}
              height={12}
              fill="var(--paper)"
              stroke="var(--link)"
              strokeWidth={2}
            />
          ),
      )}
      {fiveK.tests.length > 1 && <path d={path} fill="none" stroke="var(--link)" strokeWidth={2} />}
      {fiveK.tests.map((t) =>
        t.environment === 'outdoor' ? (
          <circle key={t.week} cx={x(t.week)} cy={y(t.seconds)} r={8} fill="var(--link)" stroke="var(--paper)" strokeWidth={2} />
        ) : (
          <rect
            key={t.week}
            x={x(t.week) - 8}
            y={y(t.seconds) - 8}
            width={16}
            height={16}
            fill="var(--link)"
            stroke="var(--paper)"
            strokeWidth={2}
          />
        ),
      )}
      <text
        className="strong"
        x={x(latest.week) + (labelRight ? 14 : -14)}
        y={y(latest.seconds) + 22}
        textAnchor={labelRight ? 'start' : 'end'}
      >
        {clock(latest.seconds)}
        {latest.environment && ` · ${ENVIRONMENT_WORD[latest.environment]}`}
      </text>
    </svg>
  )
}

function fiveKSummary(fiveK: FiveKProgress): string {
  const tests = fiveK.tests
    .map((t) => `${clock(t.seconds)} in Week ${t.week}${t.environment ? ` ${ENVIRONMENT_WORD[t.environment]}` : ''}`)
    .join(', ')
  const plan = fiveK.planned
    ? ` Planned line from ${clock(fiveK.planned.from.seconds)} to 20:00 by Week ${fiveK.planned.to.week}.`
    : ''
  const upcoming = fiveK.upcoming.length ? ` Tests to come in Weeks ${listWeeks(fiveK.upcoming.map((u) => u.week))}.` : ''
  return `5K tests: ${tests}.${plan}${upcoming}`
}

const listWeeks = (weeks: number[]) =>
  weeks.length < 2 ? weeks.join('') : `${weeks.slice(0, -1).join(', ')} and ${weeks.at(-1)}`

// ---------------------------------------------------------------------------
// Weekly completion

function CompletionPanel({
  program,
  day,
  completion,
}: {
  program: Program
  day: CoachDay
  completion: WeekCompletion[]
}) {
  const current = day.position.kind === 'in-week' ? day.position.week : null
  const lastWeek = completion.at(-1)?.week
  const phase = program.phases.find((p) => lastWeek !== undefined && lastWeek >= p.firstWeek && lastWeek <= p.lastWeek)
  const weeks = phase ? completion.filter((w) => w.week >= phase.firstWeek) : []
  return (
    <Panel
      title="Weekly completion"
      sub={phase ? `${phase.name} so far. Filled lanes are done; half-filled are Partial.` : 'Starts with Week 1.'}
      span={4}
    >
      {weeks.length > 0 ? (
        <ul className="mt-2.5">
          {weeks.map((week) => (
            <li key={week.week}>
              <CompletionRow program={program} week={week} current={week.week === current} />
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState title="No Week has started yet." />
      )}
    </Panel>
  )
}

function CompletionRow({ program, week, current }: { program: Program; week: WeekCompletion; current: boolean }) {
  const planned = program.phases.flatMap((p) => p.weeks).find((w) => w.number === week.week)
  const mark = planned ? weekMark(planned) : ''
  const tally = `${week.done} of ${week.required}`
  return (
    <Link
      href={weekPath(week.week)}
      aria-current={current ? 'date' : undefined}
      className={`grid min-h-11 grid-cols-[40px_1fr_88px] items-center gap-2.5 border-b border-rule px-1.5 py-[7px] text-ink no-underline hover:bg-sunk ${current ? 'bg-sunk' : ''}`}
    >
      <span aria-hidden="true" className={`font-extrabold font-stretch-125% ${current ? 'text-link' : ''}`}>
        {String(week.week).padStart(2, '0')}
      </span>
      <span className="sr-only">
        Week {week.week}
        {current && ', this Week'}: {completionLabel(week)}
        {mark && `, ${mark}`}
      </span>
      <WeekLanes cells={week.cells} />
      <span aria-hidden="true" className="text-right text-label text-muted">
        {current ? 'In progress' : mark || tally}
      </span>
    </Link>
  )
}

// ---------------------------------------------------------------------------
// Training load

const LANE_FILL: Record<Lane, string> = {
  speed: 'var(--speed)',
  strength: 'var(--str)',
  threshold: 'var(--thr)',
  hyrox: 'var(--hyrox)',
  easy: 'var(--easy)',
}

function LoadPanel({ program, load }: { program: Program; load: WeekLoad[] }) {
  const deloads = program.phases
    .flatMap((p) => p.weeks)
    .filter((w) => w.deload)
    .map((w) => w.number)
  const nextDeload = deloads.find((w) => w >= (load.at(-1)?.week ?? 1))
  const sub = `RPE × minutes per Week, by Session type.${nextDeload ? ` Week ${nextDeload} is a deload, so expect a dip.` : ''}`
  return (
    <Panel title="Training load" sub={sub} span={8}>
      <ChartSlot render={(width) => <LoadChart width={width} weekCount={program.weekCount} load={load} />} />
      <LaneLegend />
    </Panel>
  )
}

function LoadChart({ width: W, weekCount, load }: { width: number; weekCount: number; load: WeekLoad[] }) {
  const H = 200
  const [L, R, T, B] = [44, 12, 10, 28]
  const max = Math.max(1000, Math.ceil(Math.max(...load.map((w) => w.total)) / 500) * 500)
  const bar = Math.max(6, Math.min(14, (W - L - R) / weekCount - 4))
  const x = (week: number) => L + ((week - 0.5) / weekCount) * (W - L - R)
  const y = (value: number) => H - B - (value / max) * (H - T - B)
  const height = (value: number) => (value / max) * (H - T - B)
  const loaded = new Set(load.filter((w) => w.total > 0).map((w) => w.week))
  const yTicks = Array.from({ length: max / 500 + 1 }, (_, i) => i * 500)

  return (
    <svg className="chart" width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={loadSummary(load)}>
      {(max > 2000 ? yTicks.filter((v) => v % 1000 === 0) : yTicks).map((v) => (
        <g key={v}>
          <text x={L - 8} y={y(v) + 4} textAnchor="end">
            {v}
          </text>
          <line x1={L} x2={W - R} y1={y(v)} y2={y(v)} stroke="var(--rule)" />
        </g>
      ))}
      {ticks(W, [1, 4, 8, 12, 16, 20, 24].filter((w) => w <= weekCount)).map((w) => (
        <text key={w} x={x(w)} y={H - 6} textAnchor="middle">
          W{w}
        </text>
      ))}
      {Array.from({ length: weekCount }, (_, i) => i + 1)
        .filter((w) => !loaded.has(w))
        .map((w) => (
          <rect key={w} x={x(w) - bar / 2} y={H - B - 2} width={bar} height={2} fill="var(--edge)" />
        ))}
      {load.map((week) => {
        let below = 0
        return LANES.map((lane) => {
          const value = week.byLane[lane]
          if (!value) return null
          below += value
          // A 1px gap between segments keeps neighbouring colours apart.
          return (
            <rect
              key={`${week.week}-${lane}`}
              x={x(week.week) - bar / 2}
              y={y(below)}
              width={bar}
              height={Math.max(1, height(value) - 1)}
              fill={LANE_FILL[lane]}
            />
          )
        })
      })}
    </svg>
  )
}

function loadSummary(load: WeekLoad[]): string {
  if (load.length === 0) return 'Training load: no Week has started yet.'
  return `Training load: ${load
    .map((w, i) => `Week ${w.week}${i === load.length - 1 ? ' so far' : ''} ${w.total}`)
    .join(', ')}`
}

// ---------------------------------------------------------------------------
// Training paces

function PacesPanel({
  paces,
  fiveKTest,
  unit,
  firstTestWeek,
}: {
  paces: TrainingPaces | null
  fiveKTest: SessionLog | null
  unit: SpeedUnit
  firstTestWeek: number | null
}) {
  if (!paces || (!fiveKTest && !paces.estimate)) {
    return (
      <Panel title="Training paces" sub="Runs go by RPE until the baseline 5K test." span={4}>
        <EmptyState title="No paces yet.">
          {firstTestWeek ? `The Week ${firstTestWeek} test sets them.` : 'The first 5K test sets them.'}
        </EmptyState>
      </Panel>
    )
  }
  const speed = (secondsPerKm: number) => speedFor(secondsPerKm, unit).toFixed(1)
  const rows: [string, string, string][] = [
    ['Goal', clock(GOAL_PACE), speed(GOAL_PACE)],
    ['5K', clock(paces.fiveK), speed(paces.fiveK)],
    ['Threshold', clock(paces.threshold), speed(paces.threshold)],
    ['Easy', `${clock(paces.easy[0])}–${clock(paces.easy[1])}`, `${speed(paces.easy[1])}–${speed(paces.easy[0])}`],
  ]
  return (
    <Panel
      title="Training paces"
      sub={
        fiveKTest
          ? fromTest(fiveKTest.week, fiveKTest.date, paces.fromSeconds)
          : `Estimated from your ${clock(paces.fromSeconds)} 5K estimate. ${firstTestWeek ? `The Week ${firstTestWeek} test` : 'The first 5K test'} replaces them.`
      }
      span={4}
    >
      <table className="mt-2.5 w-full border-collapse text-[16px]">
        <thead>
          <tr className="border-b border-rule text-left text-label text-muted">
            <th scope="col" className="py-1.5">
              Pace
            </th>
            <th scope="col" className="py-1.5 text-right">
              min/km
            </th>
            <th scope="col" className="py-1.5 text-right">
              {UNIT_LABEL[unit]}
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([name, perKm, perHour]) => (
            <tr key={name} className="border-b border-rule font-semibold">
              <th scope="row" className="py-2.5 text-left font-semibold">
                {name}
              </th>
              <td className="py-2.5 text-right">{perKm}</td>
              <td className="py-2.5 text-right">{perHour}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Panel>
  )
}

const fromTest = (week: number, date: LocalDate, seconds: number) =>
  `From the ${clock(seconds)} test in Week ${week}, ${shortDay(date)}.`

// ---------------------------------------------------------------------------
// Recovery

function RecoveryPanel({ nights, today }: { nights: RecoveryNight[]; today: LocalDate }) {
  const trend = useMemo(() => recoveryTrend(nights, today), [nights, today])
  const sent = trend.filter((t) => t.night !== null)
  if (sent.length === 0) {
    const latest = nights.at(-1)
    return (
      <Panel title="Recovery" sub={`Last ${RECOVERY_NIGHTS} nights from the ring. Bars are sleep; the line is HRV.`} span={6}>
        <EmptyState title="No nights from the ring yet.">
          {latest
            ? `The last one the Shortcut sent was ${shortDay(latest.date)}.`
            : 'The morning Shortcut sends each night’s sleep and HRV from Apple Health.'}
        </EmptyState>
      </Panel>
    )
  }
  return (
    <Panel title="Recovery" sub={`Last ${RECOVERY_NIGHTS} nights from the ring. Bars are sleep; the line is HRV.`} span={6}>
      <ChartSlot render={(width) => <RecoveryChart width={width} trend={trend} />} />
      <ul aria-label="Chart key" className="mt-3 flex flex-wrap gap-x-3.5 gap-y-1.5 text-label text-muted">
        <li className="flex items-center gap-1.5">
          <i aria-hidden="true" className="inline-block size-2.5 bg-easy" />
          Sleep
        </li>
        <li className="flex items-center gap-1.5">
          <i aria-hidden="true" className="inline-block size-2.5 bg-alert" />
          Under {SHORT_SLEEP_MINUTES / 60} h
        </li>
        <li className="flex items-center gap-1.5">
          <i aria-hidden="true" className="inline-block h-[3px] w-3.5 bg-link" />
          HRV, ms
        </li>
      </ul>
    </Panel>
  )
}

type Trend = ReturnType<typeof recoveryTrend>

function RecoveryChart({ width: W, trend }: { width: number; trend: Trend }) {
  const H = 210
  const [L, R, T, B] = [34, 34, 26, 24]
  const n = trend.length
  const hours = trend.flatMap((t) => (t.night ? [t.night.sleepMinutes / 60] : []))
  const hrvs = trend.flatMap((t) => (t.night?.hrvMs ? [t.night.hrvMs] : []))
  const top = Math.max(10, Math.ceil(Math.max(...hours)))
  const hrvLow = hrvs.length ? Math.floor((Math.min(...hrvs) - 5) / 10) * 10 : 30
  const hrvHigh = Math.max(hrvLow + 30, hrvs.length ? Math.ceil((Math.max(...hrvs) + 5) / 10) * 10 : 70)
  const x = (i: number) => L + ((i + 0.5) / n) * (W - L - R)
  const ys = (h: number) => H - B - (h / top) * (H - T - B)
  const yh = (v: number) => H - B - ((v - hrvLow) / (hrvHigh - hrvLow)) * (H - T - B)
  const bar = Math.max(4, Math.min(18, (W - L - R) / n - 6))
  const hrvTicks = Array.from({ length: (hrvHigh - hrvLow) / 10 - 1 }, (_, i) => hrvLow + 10 * (i + 1))
  // The HRV line breaks where a night is missing or has no HRV.
  const path = trend
    .map((t, i) => {
      if (!t.night?.hrvMs) return ''
      const joined = i > 0 && trend[i - 1].night?.hrvMs
      return `${joined ? 'L' : 'M'}${x(i)},${yh(t.night.hrvMs)}`
    })
    .join('')
  const latest = [...trend].reverse().find((t) => t.night !== null)!
  const lastNight = latest === trend.at(-1)

  return (
    <svg className="chart" width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={recoverySummary(trend)}>
      {[0, SHORT_SLEEP_MINUTES / 60, 8].map((h) => (
        <text key={h} x={L - 6} y={ys(h) + 4} textAnchor="end">
          {h}h
        </text>
      ))}
      {hrvTicks.map((v) => (
        <text key={v} x={W - R + 6} y={yh(v) + 4}>
          {v}
        </text>
      ))}
      <text x={x(0)} y={H - 6} textAnchor="middle">
        {shortDay(trend[0].date).split(' ').slice(1).join(' ')}
      </text>
      <text x={x(n - 1)} y={H - 6} textAnchor="middle">
        {shortDay(trend[n - 1].date).split(' ').slice(1).join(' ')}
      </text>
      <line x1={L} x2={W - R} y1={ys(0)} y2={ys(0)} stroke="var(--rule)" />
      <line
        x1={L}
        x2={W - R}
        y1={ys(SHORT_SLEEP_MINUTES / 60)}
        y2={ys(SHORT_SLEEP_MINUTES / 60)}
        stroke="var(--ink)"
        strokeDasharray="4 4"
      />
      {trend.map(({ date, night }, i) =>
        night ? (
          <rect
            key={date}
            x={x(i) - bar / 2}
            y={ys(night.sleepMinutes / 60)}
            width={bar}
            height={ys(0) - ys(night.sleepMinutes / 60)}
            fill={isShortSleep(night) ? 'var(--alert)' : 'var(--easy)'}
          />
        ) : (
          <rect key={date} x={x(i) - bar / 2} y={ys(0) - 2} width={bar} height={2} fill="var(--edge)" />
        ),
      )}
      {/* A paper halo under the line keeps it legible over the bars in either theme. */}
      <path d={path} fill="none" stroke="var(--paper)" strokeWidth={8} strokeLinejoin="round" strokeLinecap="round" />
      <path d={path} fill="none" stroke="var(--link)" strokeWidth={3} strokeLinejoin="round" strokeLinecap="round" />
      {trend.map(({ date, night }, i) =>
        night?.hrvMs ? (
          <circle key={date} cx={x(i)} cy={yh(night.hrvMs)} r={4} fill="var(--link)" stroke="var(--paper)" strokeWidth={2} />
        ) : null,
      )}
      <text className="strong" x={W - R} y={12} textAnchor="end">
        {lastNight ? 'Last night' : shortDay(latest.date)}: {sleepText(latest.night!.sleepMinutes)}
        {latest.night!.hrvMs !== null && ` · ${latest.night!.hrvMs} ms`}
      </text>
    </svg>
  )
}

function recoverySummary(trend: Trend): string {
  const sent = trend.filter((t) => t.night !== null)
  const short = sent.filter((t) => isShortSleep(t.night!)).length
  const latest = sent.at(-1)!
  const when = latest === trend.at(-1) ? 'Last night' : shortDay(latest.date)
  const hrv = latest.night!.hrvMs === null ? '' : ` and HRV ${latest.night!.hrvMs} ms`
  return `Sleep and HRV for the last ${trend.length} nights: ${sent.length} from the ring, ${short} under ${SHORT_SLEEP_MINUTES / 60} hours. ${when} ${sleepText(latest.night!.sleepMinutes)}${hrv}.`
}

// ---------------------------------------------------------------------------
// Working weights

const REASON: Record<WorkingWeightChange['reason'], string> = {
  calibration: 'calibrated',
  'all-reps-easy': 'every rep at RPE 7 or easier',
  'two-holds': 'held twice in a row',
}

function WeightsPanel({ program, changes }: { program: Program; changes: WorkingWeightChange[] }) {
  const rows = useMemo(() => workingWeightRows(changes), [changes])
  const firstStrength = program.phases
    .flatMap((p) => p.weeks)
    .find((w) => w.sessions.some((s) => s.type === 'strength'))?.number
  if (rows.length === 0) {
    return (
      <Panel title="Working weights" sub="Found by calibration, then moved by your RPE." span={6}>
        <EmptyState title="No Working weights yet.">
          {firstStrength ? `Week ${firstStrength}’s Strength session finds them.` : 'The first Strength session finds them.'}
        </EmptyState>
      </Panel>
    )
  }
  return (
    <Panel title="Working weights" sub="Found by calibration, then moved by your RPE. In pounds." span={6}>
      <table className="mt-2.5 w-full border-collapse text-[16px]">
        <thead>
          <tr className="border-b border-rule text-left text-label text-muted">
            <th scope="col" className="py-1.5">
              Lift
            </th>
            <th scope="col" className="py-1.5 pl-3 text-right">
              First
            </th>
            <th scope="col" className="py-1.5 pl-3 text-right">
              Now
            </th>
            <th scope="col" className="py-1.5 pl-3">
              Last change
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.lift} className="border-b border-rule align-baseline font-semibold">
              <th scope="row" className="py-2.5 text-left font-semibold">
                {LIFT_NAME[row.lift]}
              </th>
              <td className="py-2.5 pl-3 text-right whitespace-nowrap">{row.first.pounds} lb</td>
              <td className="py-2.5 pl-3 text-right whitespace-nowrap">{row.current} lb</td>
              <td className="py-2.5 pl-3 text-label text-muted">{lastChange(row)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Panel>
  )
}

function lastChange({ last, before }: WorkingWeightRow): string {
  if (before === null) return `Week ${last.week}: ${REASON[last.reason]}`
  const step = last.pounds - before
  return `Week ${last.week}: ${step > 0 ? '+' : '−'}${Math.abs(step)} lb, ${REASON[last.reason]}`
}

// ---------------------------------------------------------------------------
// HYROX stations

const RACE_ORDER = (Object.values(STATIONS) as Station[]).sort((a, b) => a.order - b.order)

function StationsPanel({ times }: { times: StationTimes }) {
  const { simulations, hyrox, firstSimulation } = times
  const first = firstSimulation
    ? `The first is Week ${firstSimulation.week}, the week of ${shortDay(firstSimulation.startDate)}.`
    : ''
  const hasRounds = Object.keys(hyrox).length > 0
  const sub =
    simulations.length > 0
      ? `Splits from ${simulations.length === 1 ? 'one Race simulation' : `${simulations.length} Race simulations`}${hasRounds ? ', and each Station’s latest split in a HYROX round' : ''}.`
      : `No Race simulation yet.${first ? ` ${first}` : ''}${hasRounds ? ' Until then, each Station’s latest split in a HYROX round, at that round’s volume.' : ''}`

  if (simulations.length === 0 && !hasRounds) {
    return (
      <Panel title="HYROX stations" sub="Times from Race simulations and HYROX Sessions." span={12}>
        <EmptyState title={`No Race simulation yet.${first ? ` ${first}` : ''}`}>
          Station times from each HYROX Session show up here too.
        </EmptyState>
      </Panel>
    )
  }
  return (
    <Panel title="HYROX stations" sub={sub} span={12}>
      <table className="mt-2.5 w-full border-collapse text-[16px]">
        <thead>
          <tr className="border-b border-rule text-left text-label text-muted">
            <th scope="col" className="py-1.5">
              Station
            </th>
            {simulations.map((s) => (
              <th key={`${s.week}-${s.date}`} scope="col" className="py-1.5 pl-3 text-right">
                Week {s.week} sim
              </th>
            ))}
            {hasRounds && (
              <th scope="col" className="py-1.5 pl-3 text-right">
                HYROX
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {RACE_ORDER.map((station) => {
            const split = hyrox[station.id]
            return (
              <tr key={station.id} className="border-b border-rule font-semibold">
                <th scope="row" className="py-2.5 text-left font-semibold">
                  {station.name}
                </th>
                {simulations.map((s) => (
                  <td key={`${s.week}-${s.date}`} className="py-2.5 pl-3 text-right">
                    <Time seconds={s.stations[station.id]} />
                  </td>
                ))}
                {hasRounds && (
                  <td className="py-2.5 pl-3 text-right">
                    {split ? (
                      <>
                        {clock(split.seconds)}
                        <span className="block text-label text-muted">
                          {nb(`${split.reps !== null ? `${split.reps} reps` : `${split.meters} m`} · W${split.week}`)}
                        </span>
                      </>
                    ) : (
                      <Time seconds={undefined} />
                    )}
                  </td>
                )}
              </tr>
            )
          })}
        </tbody>
      </table>
    </Panel>
  )
}

function Time({ seconds }: { seconds: number | undefined }) {
  if (seconds === undefined) {
    return (
      <>
        <span aria-hidden="true" className="text-muted">
          –
        </span>
        <span className="sr-only">Not timed</span>
      </>
    )
  }
  return <>{clock(seconds)}</>
}
