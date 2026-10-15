import { useState } from 'react'
import { Button, Label, Radio, RadioGroup, Text } from 'react-aria-components'

/** The controls every Live session shares (DESIGN.md): big, flat, and still where the thumb left them. */
export const primaryButton =
  'min-h-[54px] flex-1 cursor-pointer rounded-sm bg-cobalt px-5 text-[17px] font-bold text-on-cobalt hover:bg-cobalt-hover data-focus-visible:outline-3 data-focus-visible:outline-offset-2 data-focus-visible:outline-link'
export const lineButton =
  'inline-grid min-h-[54px] flex-1 cursor-pointer place-items-center rounded-sm px-5 text-[17px] font-bold text-ink shadow-[inset_0_0_0_2px_var(--ink)] hover:bg-sunk data-focus-visible:outline-3 data-focus-visible:outline-offset-2 data-focus-visible:outline-link'
export const linkButton =
  'inline-flex min-h-11 cursor-pointer items-center text-[15px] font-bold text-link underline decoration-2 underline-offset-4 hover:decoration-[3px] data-focus-visible:outline-3 data-focus-visible:outline-offset-2 data-focus-visible:outline-link'
export const quietButton =
  'inline-flex min-h-11 cursor-pointer items-center text-[15px] font-bold text-ink hover:underline hover:decoration-2 hover:underline-offset-4 data-focus-visible:outline-3 data-focus-visible:outline-offset-2 data-focus-visible:outline-link'
/** Toggle (DESIGN.md): paper with a 2px inset edge stroke; selected inverts to ink. */
export const toggleClass =
  'grid min-h-11 cursor-pointer place-items-center rounded-sm px-1 text-center text-[15px] font-bold shadow-[inset_0_0_0_2px_var(--edge)] data-focus-visible:outline-3 data-focus-visible:outline-offset-2 data-focus-visible:outline-link data-selected:bg-ink data-selected:text-paper data-selected:shadow-none'
export const inputClass =
  'h-11 w-32 rounded-sm bg-paper px-3 text-center text-[17px] font-bold shadow-[inset_0_0_0_2px_var(--edge)] outline-none placeholder:font-semibold placeholder:text-muted focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-link data-invalid:shadow-[inset_0_0_0_2px_var(--ink)]'
export const groupLabel = 'block text-[17px] font-bold'

/**
 * Required: the Coach's Training load runs on it. It starts on the Coach's
 * prediction when there is one, so Save is the only tap when it was right.
 */
export function OverallRpe({
  value,
  missing,
  predicted = null,
  onChange,
}: {
  value: number | null
  /** Save was tapped without one. */
  missing: boolean
  /** The value the sheet started on, while it's still picked: said so, so it's never a silent guess. */
  predicted?: number | null
  onChange: (rpe: number) => void
}) {
  return (
    <RadioGroup
      value={value === null ? null : String(value)}
      onChange={(v) => onChange(Number(v))}
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
      <Text slot="description" className={`text-body-quiet ${missing ? 'font-bold text-ink' : 'text-muted'}`}>
        {missing
          ? 'Pick one first. The Coach runs on it.'
          : predicted !== null && value === predicted
            ? `The Coach’s guess: ${predicted}. Wrong? One tap. 7 is about three left; 10 is nothing left.`
            : 'The whole Session. 7 is about three left; 10 is nothing left.'}
      </Text>
    </RadioGroup>
  )
}

/**
 * A finish sheet's actions, under the thumb: stuck to the bottom of the
 * screen on the phone, bled to its edges; in place on desktop.
 */
export const finishBarClass =
  'sticky bottom-0 z-10 -mx-pad mt-auto flex flex-wrap gap-2.5 border-t-2 border-ink bg-paper px-pad pt-3 pb-[calc(12px+env(safe-area-inset-bottom))] desktop:static desktop:mx-0 desktop:border-t-0 desktop:p-0'

/** Two taps, so a stray one never throws a Session away. */
export function DiscardButton({ onDiscard }: { onDiscard: () => void }) {
  const [discarding, setDiscarding] = useState(false)
  return (
    <Button
      onPress={() => (discarding ? onDiscard() : setDiscarding(true))}
      className={`self-start justify-self-start ${quietButton}`}
    >
      {discarding ? 'Tap again to throw it away' : 'Discard session'}
    </Button>
  )
}
