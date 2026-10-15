import { Button, Checkbox, CheckboxGroup, DialogTrigger, Label, Link, Popover, Text } from 'react-aria-components'
import { EQUIPMENT, EQUIPMENT_LABEL, type Equipment } from '../../domain/equipment'
import { UNIT_LABEL, type SpeedUnit } from '../../domain/paces'
import { MONTHS, type Settings, type Theme } from '../../domain/settings'
import { SCREEN_PATH } from '../router'
import type { StartingPoint } from '../../domain/startingPoint'
import { ScenarioPicker } from './ScenarioPicker'
import { Segmented } from './Segmented'
import { StartingPointFields, type StartingFields } from './StartingPointFields'

/** The Starting point as Settings shows it: estimates to edit, or the real results that replaced them. */
export interface StartingPointEdit {
  fields: StartingFields
  onSave: (estimates: Omit<StartingPoint, 'updatedAt'>) => void
}

const THEME_OPTIONS = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
] as const satisfies readonly { value: Theme; label: string }[]

const UNIT_OPTIONS = (['kmh', 'mph'] as const).map((value) => ({ value, label: UNIT_LABEL[value] })) satisfies {
  value: SpeedUnit
  label: string
}[]

/** Toggle (DESIGN.md): paper with a 2px inset edge stroke; selected inverts to ink. */
const toggleClass =
  'grid min-h-11 cursor-pointer place-items-center rounded-sm text-[15px] font-bold shadow-[inset_0_0_0_2px_var(--edge)] data-focus-visible:outline-3 data-focus-visible:outline-offset-2 data-focus-visible:outline-link data-selected:bg-ink data-selected:text-paper data-selected:shadow-none'

const linkClass =
  'inline-flex min-h-11 items-center text-[15px] font-bold text-link underline decoration-2 underline-offset-4 hover:decoration-[3px] data-focus-visible:outline-3 data-focus-visible:outline-offset-2 data-focus-visible:outline-link'

/**
 * Settings, from the athlete's initial on the field band: theme, treadmill
 * units, which months run on the treadmill, the Equipment profile, the
 * Starting point's estimates and the data export. Every change applies at
 * once, the estimates on Save. Integrations each have a page of their own.
 */
export function SettingsPopover({
  settings,
  onChange,
  startingPoint,
}: {
  settings: Settings
  onChange: (patch: Partial<Settings>) => void
  startingPoint: StartingPointEdit
}) {
  const indoorMonths = MONTHS.filter((_, i) => settings.environmentByMonth[i] === 'indoor')

  return (
    <DialogTrigger>
      <Button
        aria-label="Settings"
        className="grid size-11 cursor-pointer place-items-center rounded-full bg-on-cobalt font-extrabold text-cobalt data-focus-visible:outline-3 data-focus-visible:outline-offset-2 data-focus-visible:outline-on-cobalt"
      >
        V
      </Button>
      {/* With no Dialog inside, the Popover is the dialog, its hidden Dismiss buttons included. */}
      <Popover
        aria-label="Settings"
        placement="bottom end"
        offset={8}
        className="popover-drop w-[264px] overflow-y-auto rounded-sm border-2 border-ink bg-paper p-[14px] text-ink shadow-[0_10px_30px_rgba(0,0,0,.18)] outline-none"
      >
        <div className="grid gap-3">
          {import.meta.env.VITE_API === 'mock' && <ScenarioPicker />}
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
                <Checkbox key={month} value={month} className={toggleClass}>
                  {month}
                </Checkbox>
              ))}
            </div>
            <Text slot="description" className="text-[12px] text-muted">
              Runs in these months are Indoor, as treadmill speed and incline. The rest are Outdoor, as pace per km.
            </Text>
          </CheckboxGroup>
          <CheckboxGroup
            value={settings.equipment}
            onChange={(equipment) => onChange({ equipment: equipment as Equipment[] })}
            className="grid gap-2"
          >
            <Label className="text-[18px] font-bold">Equipment</Label>
            <div className="grid gap-1.5">
              {EQUIPMENT.map((item) => (
                <Checkbox key={item} value={item} className={`${toggleClass} px-3`}>
                  {EQUIPMENT_LABEL[item]}
                </Checkbox>
              ))}
            </div>
            <Text slot="description" className="text-[12px] text-muted">
              What your gym has. Anything missing gets a Substitution: dumbbell calf raises for the machines, sprints
              for the jumps.
            </Text>
          </CheckboxGroup>
          <div className="grid gap-1 border-t border-rule pt-3">
            <span className="text-[18px] font-bold">Starting point</span>
            <Text className="text-[12px] text-muted">
              Estimates until a real result replaces each: a 5K test, or that lift calibrated.
            </Text>
            <StartingPointFields
              fields={startingPoint.fields}
              onSave={startingPoint.onSave}
              saveLabel="Save estimates"
              compact
            />
          </div>
          <div className="grid gap-1 border-t border-rule pt-3">
            <span className="text-[18px] font-bold">Integrations</span>
            <Link
              href={SCREEN_PATH.shortcut}
              className={linkClass}
            >
              Recovery Shortcut setup
            </Link>
            <Text className="text-[12px] text-muted">Sleep, HRV and resting heart rate from the ring, every morning.</Text>
            <Link
              href={SCREEN_PATH.workouts}
              className={linkClass}
            >
              Workout Shortcut setup
            </Link>
            <Text className="text-[12px] text-muted">Each Apple Watch workout, attached to its Session.</Text>
          </div>
          <div className="grid gap-1 border-t border-rule pt-3">
            <span className="text-[18px] font-bold">Your data</span>
            <div className="flex gap-4">
              <Link {...exportLink('/api/export.json')} className={linkClass}>
                Export JSON
              </Link>
              <Link {...exportLink('/api/export.zip')} className={linkClass}>
                Export CSV
              </Link>
            </div>
            <Text className="text-[12px] text-muted">
              Everything synced, as one JSON file or a zip with a CSV per table.
            </Text>
          </div>
        </div>
      </Popover>
    </DialogTrigger>
  )
}

/**
 * A download link; in mock mode, where Mock Service Worker doesn't see a
 * download navigation, a fetch saved as a file instead (src/mock/browser.ts).
 */
export function exportLink(href: string) {
  if (import.meta.env.VITE_API !== 'mock') return { href, download: true }
  return { onPress: () => void import('virtual:compromised-mock').then((mock) => mock.saveDownload(href)) }
}
