import { Button, Checkbox, CheckboxGroup, DialogTrigger, Label, Popover, Text } from 'react-aria-components'
import { UNIT_LABEL, type SpeedUnit } from '../../domain/paces'
import { MONTHS, type Settings, type Theme } from '../../domain/settings'
import { Segmented } from './Segmented'

const THEME_OPTIONS = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
] as const satisfies readonly { value: Theme; label: string }[]

const UNIT_OPTIONS = (['kmh', 'mph'] as const).map((value) => ({ value, label: UNIT_LABEL[value] })) satisfies {
  value: SpeedUnit
  label: string
}[]

/**
 * Settings, from the athlete's initial on the field band: theme, treadmill
 * units and which months run on the treadmill. Every change applies at once.
 */
export function SettingsPopover({
  settings,
  onChange,
}: {
  settings: Settings
  onChange: (patch: Partial<Settings>) => void
}) {
  const indoorMonths = MONTHS.filter((_, i) => settings.environmentByMonth[i] === 'indoor')

  return (
    <DialogTrigger>
      <Button
        aria-label="Settings"
        className="grid size-10 cursor-pointer place-items-center rounded-full bg-on-cobalt font-extrabold text-cobalt data-focus-visible:outline-3 data-focus-visible:outline-offset-2 data-focus-visible:outline-on-cobalt"
      >
        V
      </Button>
      {/* With no Dialog inside, the Popover is the dialog, its hidden Dismiss buttons included. */}
      <Popover
        aria-label="Settings"
        placement="bottom end"
        offset={8}
        className="w-[264px] rounded-sm border-2 border-ink bg-paper p-[14px] text-ink shadow-[0_10px_30px_rgba(0,0,0,.18)] outline-none"
      >
        <div className="grid gap-3">
          <Segmented
            label="Theme"
            value={settings.theme}
            options={THEME_OPTIONS}
            onChange={(theme) => onChange({ theme })}
          />
          <Segmented
            label="Treadmill units"
            value={settings.unit}
            options={UNIT_OPTIONS}
            onChange={(unit) => onChange({ unit })}
          />
          <CheckboxGroup
            value={indoorMonths}
            onChange={(months) =>
              onChange({ environmentByMonth: MONTHS.map((m) => (months.includes(m) ? 'indoor' : 'outdoor')) })
            }
            className="grid gap-2"
          >
            <Label className="text-[18px] font-bold">Treadmill months</Label>
            <div className="grid grid-cols-4 gap-1.5">
              {MONTHS.map((month) => (
                <Checkbox
                  key={month}
                  value={month}
                  className="grid min-h-11 cursor-pointer place-items-center rounded-sm text-[15px] font-bold shadow-[inset_0_0_0_2px_var(--edge)] data-focus-visible:outline-3 data-focus-visible:outline-offset-2 data-focus-visible:outline-link data-selected:bg-ink data-selected:text-paper data-selected:shadow-none"
                >
                  {month}
                </Checkbox>
              ))}
            </div>
            <Text slot="description" className="text-[12px] text-muted">
              Runs in these months are Indoor, as treadmill speed and incline. The rest are Outdoor, as pace per km.
            </Text>
          </CheckboxGroup>
        </div>
      </Popover>
    </DialogTrigger>
  )
}
