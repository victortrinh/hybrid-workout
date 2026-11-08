import { useState, type FormEvent } from 'react'
import {
  Button,
  FieldError,
  Form,
  Group,
  Input,
  Label,
  Link,
  NumberField,
  Radio,
  RadioGroup,
  Text,
  TextArea,
  TextField,
} from 'react-aria-components'
import type { Activity } from '../../domain/activity'
import { addDays, daysBetween, type LocalDate } from '../../domain/calendar'
import { nowMs } from '../../domain/clock'
import {
  DISTANCE_METERS,
  LOGGED_STATUSES,
  logDays,
  logFor,
  NOTES_MAX,
  RACE_SESSION_ID,
  type LoggedStatus,
  type SessionLog,
} from '../../domain/log'
import {
  clock,
  clockInput,
  consoleDistance,
  consoleMeters,
  DISTANCE_UNIT,
  parseClock,
  RUN_TEST_SESSION_ID,
  SPLIT_SECONDS,
  type SpeedUnit,
} from '../../domain/paces'
import { runTestLines, runTestRounds, runTestTimes, type RunTestRound } from '../../domain/runTest'
import type { PainArea } from '../../domain/pain'
import { sessionRpe } from '../../domain/live'
import { describeSession } from '../../domain/program/describe'
import { finishClock, parseFinish } from '../../domain/recap'
import { stations } from '../../domain/program/program'
import type { Session, Week } from '../../domain/program/types'
import { outsideWeekLine } from '../coachCopy'
import { FinishTimeField, validateFinish } from '../components/FinishTimeField'
import { Icon } from '../components/Icons'
import { answered, PainFields, type PainAnswer } from '../components/PainFields'
import { OverallRpe } from './liveUi'
import { activitySummary, km, longDay, nb, shortWeekday, STATUS_LABEL, timeOfDay } from '../format'
import { navigate, SCREEN_PATH, weekPath } from '../router'

const linkClass =
  'inline-flex min-h-11 items-center text-[15px] font-bold text-link underline decoration-2 underline-offset-4 hover:decoration-[3px]'

/** Toggle (DESIGN.md): paper with a 2px inset edge stroke; selected inverts to ink. */
const toggleClass =
  'grid min-h-11 cursor-pointer place-items-center rounded-sm px-1 text-center text-[15px] font-bold shadow-[inset_0_0_0_2px_var(--edge)] data-disabled:cursor-default data-disabled:text-muted data-disabled:shadow-[inset_0_0_0_2px_var(--rule)] data-focus-visible:outline-3 data-focus-visible:outline-offset-2 data-focus-visible:outline-link data-selected:bg-ink data-selected:text-paper data-selected:shadow-none'

const groupLabel = 'block text-[17px] font-bold'

const STATUS_HINT: Record<LoggedStatus, string> = {
  done: 'All of it, more or less as written.',
  partial: 'Some of it. Cut short or cut down.',
  skipped: 'Didn’t happen.',
  swapped: 'Did something else instead.',
}

/**
 * Log after: what happened in one Session, written after the fact. Saving
 * stores it on the phone and goes straight back to Today, which shows the log
 * at once, signal or not.
 */
export function LogAfter({
  week,
  session,
  lastDay: loggableUntil,
  logs,
  today,
  onSave,
  onPain,
  activity,
  treadmill,
  unit,
}: {
  week: Week
  session: Session
  /** The last day of the Session's Week: logged after it, it is late. */
  lastDay: LocalDate
  logs: SessionLog[]
  today: LocalDate
  onSave: (log: SessionLog) => void
  /** The pain step's answer, if given: a Pain report for this Session, from today. */
  onPain: (score: number, area: PainArea | null) => void
  /** The watch's workout the Coach attached to this Session, if any. */
  activity: Activity | null
  /** Whether a run of the watch's was on a treadmill. */
  treadmill: (activity: Activity) => boolean
  /** Settings → Treadmill units: the console reads km on km/h, mi on mph. */
  unit: SpeedUnit
}) {
  const existing = logFor(logs, week.number, session.id)
  const { days, outside, when } = logDays(week.startDate, loggableUntil, today)
  /** Early or late, it was opened from its Week: back there, not to Today. */
  const back = when ? { href: weekPath(week.number), label: `← Week ${week.number}` } : { href: SCREEN_PATH.today, label: '← Today' }

  const onTreadmill = activity !== null && treadmill(activity)
  const [status, setStatus] = useState<LoggedStatus>(existing?.status ?? 'done')
  // The watch knows the day and how long it took better than a guess does.
  const watchDay =
    activity && (days.includes(activity.date) || activity.date === outside) && daysBetween(activity.date, today) >= 0
  const [date, setDate] = useState<LocalDate | null>(existing?.date ?? (watchDay ? activity.date : today))
  const [minutes, setMinutes] = useState(existing?.minutes ?? activity?.minutes ?? session.minutes)
  /** The treadmill console's distance in its km or mi; NaN while empty. */
  const [distance, setDistance] = useState(consoleDistance(existing?.distanceMeters ?? null, unit))
  /** From the watch, Overall RPE starts on the Coach's guess, as Live's finish sheet does. */
  const [predicted] = useState(() => (activity && !existing ? sessionRpe(session) : null))
  const [rpe, setRpe] = useState<number | null>(existing?.rpe ?? predicted)
  const [notes, setNotes] = useState(existing?.notes ?? '')
  const isRace = session.id === RACE_SESSION_ID
  const [time, setTime] = useState(
    existing?.resultSeconds && isRace ? finishClock(existing.resultSeconds) : '',
  )
  /** A Compromised run test's splits and Station times, as typed. */
  const isTest = session.id === RUN_TEST_SESSION_ID
  const [rounds] = useState(() => (isTest ? runTestRounds(session) : []))
  const [splits, setSplits] = useState(() => {
    const times = runTestTimes(rounds, existing)
    const text = (t: number | null) => (t === null ? '' : clock(t))
    return { runs: times.runs.map(text), stations: times.stations.map(text) }
  })
  const [splitsMissing, setSplitsMissing] = useState(false)
  /** Unanswered gives no Pain report; the Coach goes on with the last one. */
  const [hurts, setHurts] = useState<'no' | 'yes' | null>(null)
  const [pain, setPain] = useState<PainAnswer>({ score: null, area: null })
  const [painMissing, setPainMissing] = useState(false)

  const description = describeSession(session)
  const trained = status !== 'skipped'
  /** The race has its finish, if it's known yet. */
  const finish = isRace && status === 'done'

  function submit(event: FormEvent) {
    event.preventDefault()
    if (!date) return
    const resultSeconds = finish && time.trim() !== '' ? parseFinish(time) : null
    if (finish && validateFinish(time)) return
    const testing = isTest && trained
    if (testing && [...splits.runs.map(validateSplit), ...splits.stations.map(validateStationTime)].some(Boolean)) return
    // A Done test is its four runs: their mean sets the Training paces.
    if (testing && status === 'done' && splits.runs.some((t) => t.trim() === '')) {
      setSplitsMissing(true)
      return
    }
    if (hurts === 'yes' && !answered(pain)) {
      setPainMissing(true)
      return
    }
    if (hurts === 'no') onPain(0, null)
    if (hurts === 'yes' && answered(pain)) onPain(pain.score, pain.area)
    onSave({
      id: existing?.id ?? crypto.randomUUID(),
      week: week.number,
      sessionId: session.id,
      date,
      status,
      minutes: trained && Number.isFinite(minutes) ? minutes : null,
      rpe: trained ? rpe : null,
      notes: notes.trim() === '' ? null : notes.trim(),
      resultSeconds,
      // A Live session's Environment, console distance, recovery pace, reps and sets stay with the log through an edit.
      environment: existing?.environment ?? null,
      distanceMeters: !trained
        ? null
        : onTreadmill
          ? consoleMeters(distance, unit)
          : (existing?.distanceMeters ?? null),
      recoveryPace: trained ? (existing?.recoveryPace ?? null) : null,
      intervals: trained ? (existing?.intervals ?? []) : [],
      sets: trained ? (existing?.sets ?? []) : [],
      stations: !trained
        ? []
        : isTest
          ? runTestLines(rounds, { runs: splits.runs.map(parseClock), stations: splits.stations.map(parseClock) })
          : (existing?.stations ?? []),
      updatedAt: editedAt(existing),
    })
    navigate(back.href)
  }

  return (
    <div className="px-pad pt-4 desktop:max-w-plan desktop:px-gutter desktop:pt-7">
      <Link href={back.href} className={linkClass}>
        {back.label}
      </Link>
      <p className="mt-2 text-label text-muted">
        {existing ? 'Edit log' : 'Log after'} · Week {week.number}
      </p>
      <h1 tabIndex={-1} className="mt-1 text-headline">
        {nb(description.heading)}
      </h1>
      <p className="mt-1 text-body-quiet text-muted">{nb(description.summary)}</p>
      {when && !existing && (
        <p className="mt-2 text-body">{nb(outsideWeekLine(when, week.number, week.startDate, addDays(week.startDate, 6)))}</p>
      )}
      {activity && (
        <section aria-labelledby="from-the-watch" className="mt-5 border-t-2 border-ink pt-3.5">
          <h2 id="from-the-watch" className="text-title-sm">
            From the watch
          </h2>
          <p className="mt-1 text-body">
            {nb(`${activity.workoutType}, ${longDay(activity.date)} at ${timeOfDay(activity.startedAt)}`)}
            <span className="block">{nb(activitySummary(activity, onTreadmill))}</span>
            {activity.maxHeartRate !== null && (
              <span className="block text-body-quiet text-muted">Max {activity.maxHeartRate} bpm</span>
            )}
            {onTreadmill && activity.distanceMeters !== null && (
              <span className="block text-body-quiet text-muted">
                {nb(`It guessed ${km(activity.distanceMeters)}. Treadmill: the console’s distance counts.`)}
              </span>
            )}
          </p>
        </section>
      )}

      <Form onSubmit={submit} className="mt-6 grid gap-6 border-t-2 border-ink pt-4">
        <RadioGroup value={status} onChange={(v) => setStatus(v as LoggedStatus)} className="grid gap-2">
          <Label className={groupLabel}>How did it go?</Label>
          <div className="grid grid-cols-2 gap-1.5 min-[420px]:grid-cols-4">
            {LOGGED_STATUSES.map((s) => (
              <Radio key={s} value={s} className={toggleClass}>
                {STATUS_LABEL[s]}
              </Radio>
            ))}
          </div>
          <Text slot="description" className="text-body-quiet text-muted">
            {STATUS_HINT[status]}
          </Text>
        </RadioGroup>

        <RadioGroup value={date} onChange={(v) => setDate(v as LocalDate)} className="grid gap-2">
          <Label className={groupLabel}>Day</Label>
          {/* Early, none of the Week's days has come yet: today is the only choice. */}
          {when !== 'early' && (
            <div className="grid grid-cols-7 gap-1">
              {days.map((d) => (
                <Radio
                  key={d}
                  value={d}
                  isDisabled={daysBetween(d, today) < 0}
                  aria-label={longDay(d)}
                  className={`${toggleClass} py-1 leading-tight`}
                >
                  <span aria-hidden="true">
                    {shortWeekday(d)}
                    <br />
                    {Number(d.slice(8))}
                  </span>
                </Radio>
              ))}
            </div>
          )}
          {outside && (
            <div className="grid grid-cols-2 gap-1 min-[420px]:grid-cols-4">
              <Radio value={outside} aria-label={`Today, ${longDay(outside)}`} className={toggleClass}>
                {nb(`Today · ${shortWeekday(outside)} ${Number(outside.slice(8))}`)}
              </Radio>
            </div>
          )}
        </RadioGroup>

        {finish && (
          <FinishTimeField
            value={time}
            onChange={setTime}
            labelClassName={groupLabel}
            hint="Off the results page, if it’s up: 12407 is 1:24:07."
          />
        )}

        {trained && (
          <>
            <NumberField
              value={minutes}
              onChange={setMinutes}
              minValue={1}
              maxValue={600}
              className="grid gap-2"
            >
              <Label className={groupLabel}>Duration, minutes</Label>
              <Group className="flex gap-1.5">
                <Button slot="decrement" className={`${toggleClass} size-11 shrink-0`}>
                  <Icon name="minus" />
                </Button>
                <Input className="h-11 w-24 rounded-sm bg-paper px-3 text-center text-[17px] font-bold shadow-[inset_0_0_0_2px_var(--edge)] outline-none focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-link" />
                <Button slot="increment" className={`${toggleClass} size-11 shrink-0`}>
                  <Icon name="plus" />
                </Button>
              </Group>
            </NumberField>

            {onTreadmill && (
              <NumberField
                value={distance}
                onChange={setDistance}
                minValue={Math.ceil(consoleDistance(DISTANCE_METERS[0], unit) * 10) / 10}
                maxValue={Math.floor(consoleDistance(DISTANCE_METERS[1], unit))}
                step={0.01}
                formatOptions={{ maximumFractionDigits: 2 }}
                className="grid gap-2"
              >
                <Label className={groupLabel}>Console distance, {DISTANCE_UNIT[unit]}</Label>
                <Input
                  inputMode="decimal"
                  className="h-11 w-32 rounded-sm bg-paper px-3 text-center text-[17px] font-bold shadow-[inset_0_0_0_2px_var(--edge)] outline-none focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-link"
                />
                <Text slot="description" className="text-body-quiet text-muted">
                  What the treadmill says. The watch guesses indoors.
                </Text>
              </NumberField>
            )}

            {isTest && (
              <RunTestFields
                rounds={rounds}
                value={splits}
                missing={splitsMissing}
                onChange={(next) => {
                  setSplits(next)
                  setSplitsMissing(false)
                }}
              />
            )}

            <OverallRpe value={rpe} missing={false} predicted={predicted} onChange={setRpe} />
          </>
        )}

        <RadioGroup
          value={hurts}
          onChange={(v) => {
            setHurts(v as 'no' | 'yes')
            setPainMissing(false)
          }}
          className="grid gap-2"
        >
          <Label className={groupLabel}>Anything hurt?</Label>
          <div className="grid max-w-72 grid-cols-2 gap-1.5">
            <Radio value="no" className={toggleClass}>
              No
            </Radio>
            <Radio value="yes" className={toggleClass}>
              Yes
            </Radio>
          </div>
          <Text slot="description" className={`text-body-quiet ${painMissing ? 'font-bold text-ink' : 'text-muted'}`}>
            {painMissing ? 'How bad and where, first. Or No.' : 'Pain changes what the Coach lets you do next.'}
          </Text>
        </RadioGroup>
        {hurts === 'yes' && (
          <PainFields
            value={pain}
            onChange={(p) => {
              setPain(p)
              setPainMissing(false)
            }}
          />
        )}

        <TextField value={notes} onChange={setNotes} maxLength={NOTES_MAX} className="grid gap-2">
          <Label className={groupLabel}>Notes</Label>
          <TextArea
            rows={3}
            className="rounded-sm bg-paper px-3 py-2.5 text-[17px] shadow-[inset_0_0_0_2px_var(--edge)] outline-none focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-link"
          />
        </TextField>

        <div className="flex gap-2.5">
          <Button
            type="submit"
            className="min-h-[54px] flex-1 cursor-pointer rounded-sm bg-cobalt px-5 text-[17px] font-bold text-on-cobalt hover:bg-cobalt-hover data-focus-visible:outline-3 data-focus-visible:outline-offset-2 data-focus-visible:outline-link desktop:flex-none"
          >
            Save log
          </Button>
          <Link
            href={back.href}
            className="inline-grid min-h-[54px] place-items-center rounded-sm px-5 text-[17px] font-bold text-ink no-underline shadow-[inset_0_0_0_2px_var(--ink)] hover:bg-sunk"
          >
            Cancel
          </Link>
        </div>
      </Form>
    </div>
  )
}

/** A 1 km split as typed: empty while not yet given, otherwise m:ss within what a km between Stations takes. */
function validateSplit(text: string): string | null {
  if (text.trim() === '') return null
  const seconds = parseClock(text)
  const [low, high] = SPLIT_SECONDS
  if (seconds === null) return 'Minutes and seconds, like 4:55.'
  if (seconds < low || seconds > high) return `A 1 km split between ${clock(low)} and ${clock(high)}.`
  return null
}

/** A Station time as typed: empty or m:ss. */
function validateStationTime(text: string): string | null {
  if (text.trim() === '') return null
  const seconds = parseClock(text)
  return seconds === null || seconds === 0 ? 'Minutes and seconds, like 2:05.' : null
}

const splitInputClass =
  'h-11 w-24 rounded-sm bg-paper px-3 text-center text-[17px] font-bold shadow-[inset_0_0_0_2px_var(--edge)] outline-none placeholder:font-semibold placeholder:text-muted focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-link data-invalid:shadow-[inset_0_0_0_2px_var(--ink)]'

/**
 * A Compromised run test's four rounds, written after: each round's 1 km
 * split and its Station's time, as Live would have logged them. The mean of
 * the four runs sets Race run pace.
 */
function RunTestFields({
  rounds,
  value,
  missing,
  onChange,
}: {
  rounds: RunTestRound[]
  value: { runs: string[]; stations: string[] }
  missing: boolean
  onChange: (value: { runs: string[]; stations: string[] }) => void
}) {
  const set = (key: 'runs' | 'stations', i: number, text: string) =>
    onChange({ ...value, [key]: value[key].map((t, j) => (j === i ? clockInput(text) : t)) })
  return (
    <fieldset className="grid gap-3">
      <legend className={groupLabel}>Splits</legend>
      <p className={`-mt-1 text-body-quiet ${missing ? 'font-bold text-ink' : 'text-muted'}`}>
        {missing
          ? 'All four run splits first: their average sets Race run pace.'
          : 'Each 1 km, then its Station. The average of the four runs becomes Race run pace.'}
      </p>
      {rounds.map((r, i) => (
        <div key={r.round} className="grid grid-cols-2 gap-3">
          <TextField
            value={value.runs[i]}
            onChange={(text) => set('runs', i, text)}
            validate={validateSplit}
            validationBehavior="aria"
            inputMode="numeric"
            className="grid gap-1"
          >
            <Label className="text-[15px] font-bold">Run {r.round}, 1 km</Label>
            <Input placeholder="m:ss" autoComplete="off" className={splitInputClass} />
            <FieldError className="text-body-quiet font-bold text-ink" />
          </TextField>
          <TextField
            value={value.stations[i]}
            onChange={(text) => set('stations', i, text)}
            validate={validateStationTime}
            validationBehavior="aria"
            inputMode="numeric"
            className="grid gap-1"
          >
            <Label className="text-[15px] font-bold">{stations[r.station].name}</Label>
            <Input placeholder="m:ss" autoComplete="off" className={splitInputClass} />
            <FieldError className="text-body-quiet font-bold text-ink" />
          </TextField>
        </div>
      ))}
    </fieldset>
  )
}

/** Now, or just after the edit it replaces if this device's clock is behind the one that wrote it. */
function editedAt(existing: SessionLog | null): string {
  const now = nowMs()
  const after = existing ? Date.parse(existing.updatedAt) + 1 : now
  return new Date(Math.max(now, after)).toISOString()
}
