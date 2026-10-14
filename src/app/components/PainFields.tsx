import { Label, Radio, RadioGroup } from 'react-aria-components'
import { PAIN_AREA_LABEL, PAIN_AREAS, type PainArea } from '../../domain/pain'

/** Toggle (DESIGN.md): paper with a 2px inset edge stroke; selected inverts to ink. */
const toggleClass =
  'grid min-h-11 cursor-pointer place-items-center rounded-sm px-3 text-center text-[15px] font-bold shadow-[inset_0_0_0_2px_var(--edge)] data-focus-visible:outline-3 data-focus-visible:outline-offset-2 data-focus-visible:outline-link data-selected:bg-ink data-selected:text-paper data-selected:shadow-none'

const groupLabel = 'block text-[17px] font-bold'

export interface PainAnswer {
  score: number | null
  area: PainArea | null
}

/** How bad, 1–10, and where: the pain scale and the body areas as toggles. */
export function PainFields({ value, onChange }: { value: PainAnswer; onChange: (value: PainAnswer) => void }) {
  return (
    <>
      <RadioGroup
        value={value.score === null ? null : String(value.score)}
        onChange={(v) => onChange({ ...value, score: Number(v) })}
        className="grid gap-2"
      >
        <Label className={groupLabel}>How bad, 1–10</Label>
        <div className="grid grid-cols-5 gap-1.5">
          {Array.from({ length: 10 }, (_, i) => String(i + 1)).map((v) => (
            <Radio key={v} value={v} className={toggleClass}>
              {v}
            </Radio>
          ))}
        </div>
      </RadioGroup>
      <RadioGroup
        value={value.area}
        onChange={(v) => onChange({ ...value, area: v as PainArea })}
        className="grid gap-2"
      >
        <Label className={groupLabel}>Where</Label>
        <div className="flex flex-wrap gap-1.5">
          {PAIN_AREAS.map((area) => (
            <Radio key={area} value={area} className={toggleClass}>
              {PAIN_AREA_LABEL[area]}
            </Radio>
          ))}
        </div>
      </RadioGroup>
    </>
  )
}

/** Both picked: a report to give. */
export const answered = (a: PainAnswer): a is { score: number; area: PainArea } => a.score !== null && a.area !== null
