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
import { DISTANCE_METERS, LOGGED_STATUSES, logFor, NOTES_MAX, type LoggedStatus, type SessionLog } from '../../domain/log'
import { clock, FIVE_K_SECONDS, parseClock, type Environment } from '../../domain/paces'
import type { PainArea } from '../../domain/pain'
import { describeSession } from '../../domain/program/describe'
import type { Session, Week } from '../../domain/program/types'
import { Icon } from '../components/Icons'
import { answered, PainFields, type PainAnswer } from '../components/PainFields'
import { Segmented } from '../components/Segmented'
import { activitySummary, km, longDay, nb, shortWeekday, STATUS_LABEL, timeOfDay } from '../format'
import { navigate, SCREEN_PATH } from '../router'

const linkClass =
  'inline-block py-2 text-[15px] font-bold text-link underline decoration-2 underline-offset-4 hover:decoration-[3px]'

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
  defaultEnvironment,
  onSave,
  onPain,
  activity,
  treadmill,
}: {
  week: Week
  session: Session
  /** The last day the Session can be logged on: Sunday, or later for a carried Key session. */
  lastDay: LocalDate
  logs: SessionLog[]
  today: LocalDate
  /** Where runs happen on a day unless the log says otherwise: the month's setting. */
  defaultEnvironment: (date: LocalDate) => Environment
  onSave: (log: SessionLog) => void
  /** The pain step's answer, if given: a Pain report for this Session, from today. */
  onPain: (score: number, area: PainArea | null) => void
  /** The watch's workout the Coach attached to this Session, if any. */
  activity: Activity | null
  /** Whether a run of the watch's was on a treadmill. */
  treadmill: (activity: Activity) => boolean
}) {
  const existing = logFor(logs, week.number, session.id)
  const days = Array.from({ length: daysBetween(week.startDate, loggableUntil) + 1 }, (_, i) => addDays(week.startDate, i))
  const last = days.at(-1)!
  const lastDay = days.find((d) => d === today) ?? (daysBetween(today, last) < 0 ? last : null)

  const onTreadmill = activity !== null && treadmill(activity)
  const [status, setStatus] = useState<LoggedStatus>(existing?.status ?? 'done')
  // The watch knows the day and how long it took better than a guess does.
  const watchDay = activity && days.includes(activity.date) && daysBetween(activity.date, lastDay ?? activity.date) >= 0
  const [date, setDate] = useState<LocalDate | null>(existing?.date ?? (watchDay ? activity.date : lastDay))
  const [minutes, setMinutes] = useState(existing?.minutes ?? activity?.minutes ?? session.minutes)
  /** The treadmill console's distance in km; NaN while empty. */
  const [consoleKm, setConsoleKm] = useState(existing?.distanceMeters ? existing.distanceMeters / 1000 : NaN)
  const [rpe, setRpe] = useState<number | null>(existing?.rpe ?? null)
  const [notes, setNotes] = useState(existing?.notes ?? '')
  const [time, setTime] = useState(existing?.resultSeconds ? clock(existing.resultSeconds) : '')
  /** Null follows the month's default for the chosen day. */
  const [environment, setEnvironment] = useState<Environment | null>(existing?.environment ?? null)
  /** Unanswered gives no Pain report; the Coach goes on with the last one. */
  const [hurts, setHurts] = useState<'no' | 'yes' | null>(null)
  const [pain, setPain] = useState<PainAnswer>({ score: null, area: null })
  const [painMissing, setPainMissing] = useState(false)

  const description = describeSession(session)
  const trained = status !== 'skipped'
  /** Only a Done 5K test has a time: it resets the Training paces. */
  const result = session.type === '5k-test' && status === 'done'
  const where = environment ?? (date ? defaultEnvironment(date) : 'outdoor')

  function submit(event: FormEvent) {
    event.preventDefault()
    if (!date) return
    const resultSeconds = result ? parseClock(time) : null
    if (result && resultSeconds === null) return
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
      // A Live session's Environment, console distance, reps and sets stay with the log through an edit.
      environment: result ? where : (existing?.environment ?? null),
      distanceMeters: !trained
        ? null
        : onTreadmill
          ? Number.isFinite(consoleKm)
            ? Math.round(consoleKm * 1000)
            : null
          : (existing?.distanceMeters ?? null),
      intervals: trained ? (existing?.intervals ?? []) : [],
      sets: trained ? (existing?.sets ?? []) : [],
      stations: trained ? (existing?.stations ?? []) : [],
      updatedAt: editedAt(existing),
    })
    navigate(SCREEN_PATH.today)
  }

  return (
    <div className="px-pad pt-4 desktop:max-w-plan desktop:px-gutter desktop:pt-7">
      <Link href={SCREEN_PATH.today} className={linkClass}>
        ← Today
      </Link>
      <p className="mt-2 text-label text-muted">
        {existing ? 'Edit log' : 'Log after'} · Week {week.number}
      </p>
      <h1 tabIndex={-1} className="mt-1 text-headline">
        {nb(description.heading)}
      </h1>
      <p className="mt-1 text-body-quiet text-muted">{nb(description.summary)}</p>
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

      {!lastDay ? (
        <p className="mt-6 text-body">Week {week.number} hasn’t started. Nothing to log yet.</p>
      ) : (
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
            <div className="grid grid-cols-7 gap-1">
              {days.map((d) => (
                <Radio
                  key={d}
                  value={d}
                  isDisabled={daysBetween(d, lastDay) < 0}
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
          </RadioGroup>

          {result && (
            <>
              <TextField
                value={time}
                onChange={setTime}
                isRequired
                validate={validateTime}
                inputMode="numeric"
                className="grid gap-2"
              >
                {({ isInvalid }) => (
                  <>
                    <Label className={groupLabel}>5 km time</Label>
                    <Input
                      placeholder="mm:ss"
                      autoComplete="off"
                      className="h-11 w-32 rounded-sm bg-paper px-3 text-center text-[17px] font-bold shadow-[inset_0_0_0_2px_var(--edge)] outline-none placeholder:font-semibold placeholder:text-muted focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-link data-invalid:shadow-[inset_0_0_0_2px_var(--ink)]"
                    />
                    {/* The error takes the hint's place, so nothing below moves when it clears. */}
                    {isInvalid ? (
                      <FieldError className="text-body-quiet font-bold text-ink" />
                    ) : (
                      <Text slot="description" className="text-body-quiet text-muted">
                        Minutes and seconds, like 23:00. It sets the Training paces.
                      </Text>
                    )}
                  </>
                )}
              </TextField>

              <Segmented
                label="Where"
                labelClassName={groupLabel}
                className="max-w-72"
                value={where}
                options={[
                  { value: 'indoor', label: 'Indoor' },
                  { value: 'outdoor', label: 'Outdoor' },
                ]}
                onChange={setEnvironment}
              />
            </>
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
                  value={consoleKm}
                  onChange={setConsoleKm}
                  minValue={DISTANCE_METERS[0] / 1000}
                  maxValue={DISTANCE_METERS[1] / 1000}
                  step={0.01}
                  formatOptions={{ maximumFractionDigits: 2 }}
                  className="grid gap-2"
                >
                  <Label className={groupLabel}>Console distance, km</Label>
                  <Input
                    inputMode="decimal"
                    className="h-11 w-32 rounded-sm bg-paper px-3 text-center text-[17px] font-bold shadow-[inset_0_0_0_2px_var(--edge)] outline-none focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-link"
                  />
                  <Text slot="description" className="text-body-quiet text-muted">
                    What the treadmill says. The watch guesses indoors.
                  </Text>
                </NumberField>
              )}

              <RadioGroup
                value={rpe === null ? null : String(rpe)}
                onChange={(v) => setRpe(Number(v))}
                className="grid gap-2"
              >
                <Label className={groupLabel}>Overall RPE</Label>
                <div className="grid grid-cols-5 gap-1.5">
                  {Array.from({ length: 10 }, (_, i) => String(i + 1)).map((v) => (
                    <Radio key={v} value={v} className={toggleClass}>
                      {v}
                    </Radio>
                  ))}
                </div>
                <Text slot="description" className="text-body-quiet text-muted">
                  The whole Session. 7 is about three reps left in the tank; 10 is nothing left.
                </Text>
              </RadioGroup>
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
              href={SCREEN_PATH.today}
              className="inline-grid min-h-[54px] place-items-center rounded-sm px-5 text-[17px] font-bold text-ink no-underline shadow-[inset_0_0_0_2px_var(--ink)] hover:bg-sunk"
            >
              Cancel
            </Link>
          </div>
        </Form>
      )}
    </div>
  )
}

/** A 5 km time as typed: mm:ss, within what a 5K test can believably take. */
export function validateTime(text: string): string | null {
  const seconds = parseClock(text)
  if (seconds === null) return 'Minutes and seconds, like 23:00. That isn’t a time.'
  const [low, high] = FIVE_K_SECONDS
  if (seconds < low || seconds > high) return `A 5 km time between ${clock(low)} and ${clock(high)}.`
  return null
}

/** Now, or just after the edit it replaces if this device's clock is behind the one that wrote it. */
function editedAt(existing: SessionLog | null): string {
  const now = Date.now()
  const after = existing ? Date.parse(existing.updatedAt) + 1 : now
  return new Date(Math.max(now, after)).toISOString()
}
