import { FieldError, Input, Label, Text, TextField } from 'react-aria-components'
import { RACE_SECONDS } from '../../domain/log'
import { finishClock, finishInput, parseFinish } from '../../domain/recap'

/** A finish time as typed: h:mm:ss, within what a Men's Open can believably take. Empty is fine unless required. */
export function validateFinish(text: string): string | null {
  if (text.trim() === '') return null
  const seconds = parseFinish(text)
  if (seconds === null) return 'Hours, minutes, seconds, like 1:24:07. That isn’t a time.'
  const [low, high] = RACE_SECONDS
  if (seconds < low || seconds > high) return `A finish between ${finishClock(low)} and ${finishClock(high)}.`
  return null
}

/**
 * The race's finish time, typed on the number pad: the digits show as a clock
 * as they go ("12407" reads 1:24:07), as the 5 km time does in Log after.
 */
export function FinishTimeField({
  value,
  onChange,
  isRequired = false,
  labelClassName,
  hint,
}: {
  value: string
  onChange: (value: string) => void
  isRequired?: boolean
  labelClassName: string
  hint: string
}) {
  return (
    <TextField
      value={value}
      onChange={(text) => onChange(finishInput(text))}
      isRequired={isRequired}
      validate={validateFinish}
      inputMode="numeric"
      className="grid gap-2"
    >
      {({ isInvalid }) => (
        <>
          <Label className={labelClassName}>Finish time</Label>
          <Input
            placeholder="h:mm:ss"
            autoComplete="off"
            className="h-[54px] w-40 rounded-sm bg-paper px-3 text-center text-[21px] font-extrabold font-stretch-125% shadow-[inset_0_0_0_2px_var(--edge)] outline-none placeholder:text-[17px] placeholder:font-semibold placeholder:font-stretch-100% placeholder:text-muted focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-link data-invalid:shadow-[inset_0_0_0_2px_var(--ink)]"
          />
          {/* The error takes the hint's place, so nothing below moves when it clears. */}
          {isInvalid ? (
            <FieldError className="text-body-quiet font-bold text-ink" />
          ) : (
            <Text slot="description" className="text-body-quiet text-muted">
              {hint}
            </Text>
          )}
        </>
      )}
    </TextField>
  )
}
