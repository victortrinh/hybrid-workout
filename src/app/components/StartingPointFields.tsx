import { useId, useState, type FormEvent, type ReactNode } from 'react'
import { Button, FieldError, Form, Input, Label, Text, TextField } from 'react-aria-components'
import { clock, clockInput, FIVE_K_SECONDS, parseClock } from '../../domain/paces'
import {
  ESTIMATE_POUNDS,
  ESTIMATED_LIFT_LABEL,
  ESTIMATED_LIFTS,
  type EstimatedLift,
  type StartingField,
  type StartingPoint,
} from '../../domain/startingPoint'

type Estimates = Omit<StartingPoint, 'updatedAt'>

export interface StartingFields {
  fiveK: StartingField
  lifts: Record<EstimatedLift, StartingField>
}

const inputClass =
  'h-11 rounded-sm bg-paper px-3 text-center text-[17px] font-bold shadow-[inset_0_0_0_2px_var(--edge)] outline-none placeholder:font-semibold placeholder:text-muted focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-link data-invalid:shadow-[inset_0_0_0_2px_var(--ink)]'

const primaryClass =
  'min-h-[54px] cursor-pointer rounded-sm bg-cobalt px-5 text-[17px] font-bold text-on-cobalt hover:bg-cobalt-hover data-focus-visible:outline-3 data-focus-visible:outline-offset-2 data-focus-visible:outline-link'

/** An estimated 5K time as typed: empty skips it, otherwise mm:ss within what a 5K takes. */
export function validateEstimatedTime(text: string): string | null {
  if (text.trim() === '') return null
  const seconds = parseClock(text)
  if (seconds === null) return 'Minutes and seconds, like 21:00. That isn’t a time.'
  const [low, high] = FIVE_K_SECONDS
  if (seconds < low || seconds > high) return `A 5 km time between ${clock(low)} and ${clock(high)}.`
  return null
}

/** An estimated Working weight as typed: empty skips it, otherwise whole pounds. */
export function validatePounds(text: string): string | null {
  if (text.trim() === '') return null
  const pounds = Number(text)
  const [low, high] = ESTIMATE_POUNDS
  if (!/^\d+$/.test(text.trim()) || pounds < low || pounds > high) return `Whole pounds, from ${low} to ${high}.`
  return null
}

/**
 * The Starting point's fields, at first launch and in Settings: an estimated
 * 5K time and estimated Working weights, each optional. A field a real result
 * has replaced shows that result, read-only.
 */
export function StartingPointFields({
  fields,
  onSave,
  saveLabel,
  compact = false,
  children,
}: {
  fields: StartingFields
  onSave: (estimates: Estimates) => void
  saveLabel: string
  /** Settings' narrow popover: smaller labels, the hints shortened. */
  compact?: boolean
  /** Beside the save button: Skip at first launch. */
  children?: ReactNode
}) {
  const [time, setTime] = useState(fields.fiveK.real || fields.fiveK.value === null ? '' : clock(fields.fiveK.value))
  const [pounds, setPounds] = useState<Record<EstimatedLift, string>>(
    () =>
      Object.fromEntries(
        ESTIMATED_LIFTS.map((lift) => {
          const field = fields.lifts[lift]
          return [lift, field.real || field.value === null ? '' : String(field.value)]
        }),
      ) as Record<EstimatedLift, string>,
  )
  const [saved, setSaved] = useState(false)
  const id = useId()
  const label = compact ? 'block text-[15px] font-bold' : 'block text-[17px] font-bold'
  const heading = compact ? 'text-label text-muted' : 'text-title-sm'
  const hint = `${compact ? 'text-[12px]' : 'text-body-quiet'} text-muted`
  const editable = !fields.fiveK.real || ESTIMATED_LIFTS.some((l) => !fields.lifts[l].real)

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (validateEstimatedTime(time) || ESTIMATED_LIFTS.some((l) => validatePounds(pounds[l]))) return
    // A field a real result replaced has no estimate left to keep: the real result stands.
    const weights: Estimates['weights'] = {}
    for (const lift of ESTIMATED_LIFTS) {
      const text = pounds[lift].trim()
      if (!fields.lifts[lift].real && text !== '') weights[lift] = Number(text)
    }
    onSave({ fiveKSeconds: fields.fiveK.real ? null : parseClock(time), weights })
    setSaved(true)
  }

  return (
    <Form onSubmit={submit} className={compact ? 'grid gap-3' : 'grid gap-7'}>
      <section aria-labelledby={`${id}-5k`} className="grid gap-2">
        <h2 id={`${id}-5k`} className={heading}>
          Estimated 5K time
        </h2>
        {fields.fiveK.real ? (
          <ReadOnly
            label="5 km time"
            value={clock(fields.fiveK.value!)}
            note="From your 5K test: it sets the Training paces now."
            hint={hint}
            labelClass={label}
          />
        ) : (
          <TextField
            value={time}
            onChange={(text) => {
              setTime(clockInput(text))
              setSaved(false)
            }}
            validate={validateEstimatedTime}
            validationBehavior="aria"
            inputMode="numeric"
            className="grid gap-2"
          >
            {({ isInvalid }) => (
              <>
                <Label className={label}>5 km time</Label>
                <Input placeholder="mm:ss" autoComplete="off" className={`${inputClass} w-32`} />
                {isInvalid ? (
                  <FieldError className="text-body-quiet font-bold text-ink" />
                ) : (
                  <Text slot="description" className={hint}>
                    {compact
                      ? 'Estimated Training paces until your first 5K test.'
                      : 'Your best guess today. It sets estimated Training paces until the first 5K test replaces them. Leave it empty to run by RPE.'}
                  </Text>
                )}
              </>
            )}
          </TextField>
        )}
      </section>

      <section aria-labelledby={`${id}-weights`} className="grid gap-2">
        <h2 id={`${id}-weights`} className={heading}>
          Estimated Working weights
        </h2>
        {!compact && (
          <p className={hint}>
            The load you’d use for main sets of about 5 at RPE 7. Week 1’s calibration starts at about 70% of it and
            still ramps to RPE 7. Leave one empty to start from the empty bar.
          </p>
        )}
        <div className="grid gap-3">
          {ESTIMATED_LIFTS.map((lift) => {
            const field = fields.lifts[lift]
            return field.real ? (
              <ReadOnly
                key={lift}
                label={`${ESTIMATED_LIFT_LABEL[lift]}, lb`}
                value={`${field.value} lb`}
                note="Your Working weight, from calibration."
                hint={hint}
                labelClass={label}
              />
            ) : (
              <TextField
                key={lift}
                value={pounds[lift]}
                onChange={(text) => {
                  setPounds((p) => ({ ...p, [lift]: text.replace(/\D/g, '').slice(0, 4) }))
                  setSaved(false)
                }}
                validate={validatePounds}
                validationBehavior="aria"
                inputMode="numeric"
                className="grid gap-2"
              >
                <Label className={label}>{ESTIMATED_LIFT_LABEL[lift]}, lb</Label>
                <Input placeholder="lb" autoComplete="off" className={`${inputClass} w-28`} />
                <FieldError className="text-body-quiet font-bold text-ink" />
              </TextField>
            )
          })}
        </div>
      </section>

      {editable && (
        <div className="flex flex-wrap items-center gap-2.5">
          <Button type="submit" className={`${primaryClass} ${compact ? 'min-h-11 text-[15px]' : 'flex-1 desktop:flex-none'}`}>
            {saveLabel}
          </Button>
          {children}
          {compact && saved && (
            <span role="status" className="text-[12px] text-muted">
              Saved.
            </span>
          )}
        </div>
      )}
    </Form>
  )
}

function ReadOnly({
  label,
  value,
  note,
  hint,
  labelClass,
}: {
  label: string
  value: string
  note: string
  hint: string
  labelClass: string
}) {
  return (
    <TextField value={value} isReadOnly className="grid gap-2">
      <Label className={labelClass}>{label}</Label>
      <Input className={`${inputClass} w-32 shadow-[inset_0_0_0_2px_var(--rule)]`} />
      <Text slot="description" className={hint}>
        {note}
      </Text>
    </TextField>
  )
}
