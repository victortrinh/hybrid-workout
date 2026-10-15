import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { Button, Form, Link } from 'react-aria-components'
import { programStart } from '../../domain/coach'
import { RACE_SESSION_ID } from '../../domain/log'
import { clock } from '../../domain/paces'
import { LIFT_NAME } from '../../domain/program/describe'
import { program } from '../../domain/program/program'
import type { Lane } from '../../domain/program/types'
import { parseFinish, type ProgramRecap, type RaceResult } from '../../domain/recap'
import { raceCopy } from '../coachCopy'
import { ActionBar } from '../components/ActionBar'
import { buttonBase, primaryAction } from '../components/actions'
import { FinishTimeField, validateFinish } from '../components/FinishTimeField'
import { LANE_NAME, LANES } from '../components/LaneChip'
import { exportLink } from '../components/SettingsPopover'
import { nb, shortDay } from '../format'
import { logPath } from '../router'

/** What Today holds after Race day: the race's result, the recap, and the one step to log the time. */
export interface AfterRace {
  result: RaceResult
  recap: ProgramRecap
  /** Logs the race's finish time: the race log in one step, or the time added to it. */
  onFinish: (seconds: number) => void
}

const link = `${buttonBase} text-link underline decoration-2 underline-offset-4 hover:decoration-[3px]`
const groupLabel = 'block text-[17px] font-bold'

/**
 * Today's lead after Race day: the Coach's verdict on the Program, or the one
 * question it can't answer itself (the finish time).
 * `children` carries what Today always has under the lead: Something hurts and
 * the sync line.
 */
export function RaceLead({ race, children }: { race: AfterRace; children?: ReactNode }) {
  const { result, recap, onFinish } = race
  const copy = raceCopy(result, recap)
  const [time, setTime] = useState('')

  function submit(event: FormEvent) {
    event.preventDefault()
    const seconds = parseFinish(time)
    if (seconds === null || validateFinish(time)) return
    onFinish(seconds)
  }

  return (
    <div className="px-pad pt-5 desktop:px-0 desktop:pt-7">
      <h1 id="today-heading" tabIndex={-1} className="text-headline">
        {nb(copy.heading)}
      </h1>
      <p className="mt-2 text-prescription">{nb(copy.target)}</p>

      {result.state === 'ask' ? (
        <>
          <Form id="finish-form" onSubmit={submit} className="mt-5">
            <FinishTimeField
              value={time}
              onChange={setTime}
              isRequired
              labelClassName={groupLabel}
              hint="Hours, minutes, seconds: 12407 is 1:24:07."
            />
          </Form>
          <ActionBar label="Race result">
            <div className="flex gap-2.5">
              <Button type="submit" form="finish-form" className={primaryAction}>
                Save finish time
              </Button>
            </div>
          </ActionBar>
        </>
      ) : (
        result.state === 'finished' && (
          <Link href={logPath(program.weekCount, RACE_SESSION_ID)} className={`mt-1 ${link}`}>
            Edit the race log
          </Link>
        )
      )}

      {children}

    </div>
  )
}

/** What happens now: a week off, the export, and the next race. Under the recap on the phone, under the lead on desktop. */
export function WhatsNext() {
  return (
    <section
      aria-labelledby="next-heading"
      className="mx-pad mt-section border-t-2 border-ink pt-3.5 desktop:col-start-1 desktop:mx-0"
    >
      <h2 id="next-heading" className="text-title">
        What’s next
      </h2>
      <dl className="mt-1.5">
        <NextRow term="This week">
          Walking, easy spinning, sleeping. Nothing timed, nothing heavy. 8 km and 8 Stations earn a week off.
        </NextRow>
        <NextRow term="The numbers">
          Every log, yours to keep.
          <span className="mt-0.5 flex gap-5">
            <Link {...exportLink('/api/export.zip')} className={link}>
              Export CSV
            </Link>
            <Link {...exportLink('/api/export.json')} className={link}>
              Export JSON
            </Link>
          </span>
        </NextRow>
        <NextRow term="Another race">
          A new Program, counted back from its date. Pick one before the fitness notices it’s been left alone.
        </NextRow>
      </dl>
    </section>
  )
}

function NextRow({ term, children }: { term: string; children: ReactNode }) {
  return (
    <div className="grid gap-1 border-b border-rule py-3.5 desktop:grid-cols-[132px_1fr] desktop:gap-4">
      <dt className="text-[17px] font-bold">{term}</dt>
      <dd className="grid text-body-quiet text-muted">{children}</dd>
    </div>
  )
}

/**
 * The Program in four numbers, solid (the striped one is the finish time
 * above): the 5K first to last, the Working weights first to now, Sessions
 * done, and where the Training load went, one lane per Session type.
 */
export function ProgramRecapPanel({ recap }: { recap: ProgramRecap }) {
  const start = programStart(program)
  const { fiveK, workingWeights, sessions, trainingLoad } = recap
  return (
    <section
      aria-labelledby="recap-heading"
      className="px-pad desktop:col-start-2 desktop:row-span-2 desktop:row-start-2 desktop:px-0 desktop:pt-7"
    >
      <h2
        id="recap-heading"
        className="mt-section flex items-baseline justify-between gap-3 border-t-2 border-ink pt-3.5 text-title desktop:mt-[22px] desktop:border-t-0 desktop:pt-0"
      >
        The Program
        <small className="text-[14px] font-medium tracking-normal text-muted font-stretch-100%">
          since {shortDay(start)}
        </small>
      </h2>
      <dl className="mt-1.5">
        <RecapRow
          term="5K test"
          figure={fiveK ? clock(fiveK.last.seconds) : '–'}
          detail={
            !fiveK
              ? 'None logged. The paces were guesses all the way.'
              : fiveK.first.week === fiveK.last.week
                ? `Week ${fiveK.first.week}, the only one logged`
                : `${clock(fiveK.first.seconds)} in Week ${fiveK.first.week} · ${fiveKChange(fiveK.first.seconds, fiveK.last.seconds)}${fiveK.sub20 ? ' · sub-20' : ''}`
          }
        />
        <div className="border-b border-rule py-3.5">
          <dt className="text-[17px] font-bold">Working weights</dt>
          <dd>
            {workingWeights.length === 0 ? (
              <p className="mt-1 text-[14px] text-muted">None found. The Strength sessions stayed unlogged.</p>
            ) : (
              <ul className="mt-1.5 grid gap-1">
                {workingWeights.map((w) => (
                  <li key={w.lift} className="grid grid-cols-[1fr_auto_auto] items-baseline gap-x-3 text-[15px]">
                    <span>{LIFT_NAME[w.lift]}</span>
                    <span className="text-muted">
                      {w.first} → <b className="font-extrabold text-ink">{w.now} lb</b>
                    </span>
                    <span className="w-12 text-right text-[14px] font-bold text-muted">{signed(w.now - w.first)}</span>
                  </li>
                ))}
              </ul>
            )}
          </dd>
        </div>
        <RecapRow
          term="Sessions done"
          figure={String(sessions.done)}
          detail={`of ${sessions.required} · ${sessions.easy} Easy ${sessions.easy === 1 ? 'run' : 'runs'} on top`}
        />
        <RecapRow
          term="Training load"
          figure={trainingLoad.total.toLocaleString('en-CA')}
          detail="RPE × minutes, every Session trained"
        >
          <LoadLane byLane={trainingLoad.byLane} total={trainingLoad.total} />
        </RecapRow>
      </dl>
    </section>
  )
}

function RecapRow({
  term,
  figure,
  detail,
  children,
}: {
  term: string
  figure: string
  detail: string
  children?: ReactNode
}) {
  return (
    <div className="grid grid-cols-[1fr_auto] items-end gap-x-3 border-b border-rule py-3.5">
      <dt className="text-[17px] font-bold">{term}</dt>
      <dd className="row-span-2 self-center text-[34px] leading-none font-black tracking-[-0.03em] font-stretch-125%">
        {figure}
      </dd>
      <dd className="text-[14px] text-muted">{detail}</dd>
      {children && <dd className="col-span-full">{children}</dd>}
    </div>
  )
}

/** Where the Training load went: one 12px lane cut by Session type, filling from the left, then the names. */
function LoadLane({ byLane, total }: { byLane: Partial<Record<Lane, number>>; total: number }) {
  const [filled, setFilled] = useState(false)
  useEffect(() => {
    const frame = requestAnimationFrame(() => setFilled(true))
    return () => cancelAnimationFrame(frame)
  }, [])
  const lanes = LANES.filter((lane) => (byLane[lane] ?? 0) > 0)
  if (total === 0) return null
  const share = (lane: Lane) => Math.round(((byLane[lane] ?? 0) / total) * 100)
  return (
    <>
      <span className="mt-3 block h-3 bg-rule" aria-hidden="true">
        <span className="lane-fill flex h-full overflow-hidden" style={{ width: filled ? '100%' : '0%' }}>
          {lanes.map((lane) => (
            <i
              key={lane}
              className={`h-full shrink-0 ${LANE_FILL[lane]}`}
              style={{ width: `${((byLane[lane] ?? 0) / total) * 100}%` }}
            />
          ))}
        </span>
      </span>
      <ul className="mt-2 flex flex-wrap gap-x-3.5 gap-y-1 text-label text-muted">
        {lanes.map((lane) => (
          <li key={lane} className="flex items-center gap-1.5">
            <i className={`size-2.5 ${LANE_FILL[lane]}`} aria-hidden="true" />
            {LANE_NAME[lane]} {share(lane)}%
          </li>
        ))}
      </ul>
    </>
  )
}

const LANE_FILL: Record<Lane, string> = {
  speed: 'bg-speed',
  strength: 'bg-strength',
  threshold: 'bg-threshold',
  hyrox: 'bg-hyrox',
  easy: 'bg-easy',
}

function fiveKChange(first: number, last: number): string {
  if (last < first) return `${clock(first - last)} faster`
  if (last > first) return `${clock(last - first)} slower`
  return 'same time'
}

const signed = (n: number) => (n > 0 ? `+${n}` : n < 0 ? `−${Math.abs(n)}` : '±0')
