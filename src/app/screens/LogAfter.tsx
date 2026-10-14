import { useState, type FormEvent } from 'react'
import {
  Button,
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
import { addDays, daysBetween, type LocalDate } from '../../domain/calendar'
import { LOGGED_STATUSES, logFor, NOTES_MAX, type LoggedStatus, type SessionLog } from '../../domain/log'
import { describeSession } from '../../domain/program/describe'
import type { Session, Week } from '../../domain/program/types'
import { Icon } from '../components/Icons'
import { longDay, nb, shortWeekday, STATUS_LABEL } from '../format'
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
 * goes straight back to Today, which shows the log at once.
 */
export function LogAfter({
  week,
  session,
  logs,
  today,
  onSave,
}: {
  week: Week
  session: Session
  logs: SessionLog[]
  today: LocalDate
  onSave: (log: SessionLog) => Promise<boolean>
}) {
  const existing = logFor(logs, week.number, session.id)
  const days = Array.from({ length: 7 }, (_, i) => addDays(week.startDate, i))
  const lastDay = days.find((d) => d === today) ?? (daysBetween(today, days[6]) < 0 ? days[6] : null)

  const [status, setStatus] = useState<LoggedStatus>(existing?.status ?? 'done')
  const [date, setDate] = useState<LocalDate | null>(existing?.date ?? lastDay)
  const [minutes, setMinutes] = useState(existing?.minutes ?? session.minutes)
  const [rpe, setRpe] = useState<number | null>(existing?.rpe ?? null)
  const [notes, setNotes] = useState(existing?.notes ?? '')

  const description = describeSession(session)
  const trained = status !== 'skipped'

  function submit(event: FormEvent) {
    event.preventDefault()
    if (!date) return
    void onSave({
      id: existing?.id ?? crypto.randomUUID(),
      week: week.number,
      sessionId: session.id,
      date,
      status,
      minutes: trained && Number.isFinite(minutes) ? minutes : null,
      rpe: trained ? rpe : null,
      notes: notes.trim() === '' ? null : notes.trim(),
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

/** Now, or just after the edit it replaces if this device's clock is behind the one that wrote it. */
function editedAt(existing: SessionLog | null): string {
  const now = Date.now()
  const after = existing ? Date.parse(existing.updatedAt) + 1 : now
  return new Date(Math.max(now, after)).toISOString()
}
