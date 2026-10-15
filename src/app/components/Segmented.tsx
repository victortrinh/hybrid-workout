import { useId } from 'react'
import { Label, Radio, RadioGroup } from 'react-aria-components'
import { motion } from 'motion/react'

/**
 * Segmented control (DESIGN.md): one 2px ink border around equal segments;
 * the chosen one inverts to ink with paper text. The ink block slides to a
 * new choice rather than jumping, a marker changing lanes.
 */
export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
  className = '',
  labelClassName = 'text-[18px] font-bold',
}: {
  label: string
  value: T
  options: readonly { value: T; label: string }[]
  onChange: (value: T) => void
  className?: string
  labelClassName?: string
}) {
  const marker = useId()
  return (
    <RadioGroup value={value} onChange={(v) => onChange(v as T)} className={`grid gap-2 ${className}`}>
      <Label className={labelClassName}>{label}</Label>
      <div className="flex overflow-hidden rounded-sm border-2 border-ink">
        {options.map((option) => (
          <Radio
            key={option.value}
            value={option.value}
            className="relative isolate grid min-h-11 flex-1 cursor-pointer place-items-center px-2 text-[15px] font-bold data-focus-visible:outline-3 data-focus-visible:-outline-offset-4 data-focus-visible:outline-link data-selected:text-paper"
          >
            {({ isSelected }) => (
              <>
                {isSelected && <motion.span layoutId={marker} aria-hidden="true" className="absolute inset-0 -z-10 bg-ink" />}
                {option.label}
              </>
            )}
          </Radio>
        ))}
      </div>
    </RadioGroup>
  )
}
