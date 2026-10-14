import { useId, useState, useSyncExternalStore, type ReactNode } from 'react'
import {
  Button,
  Checkbox,
  DialogTrigger,
  Heading,
  Input,
  Label,
  NumberField,
  Popover,
  Radio,
  RadioGroup,
  TextField,
} from 'react-aria-components'
import type { MockControls, NetworkMode, NightFields, SendOutcome, WorkoutFields } from '../../mock/controls'
import { longDay } from '../format'
import type { MockInfo } from '../mockInfo'
import { Segmented } from './Segmented'

const NETWORK: readonly { value: NetworkMode; label: string }[] = [
  { value: 'online', label: 'Online' },
  { value: 'offline', label: 'Offline' },
  { value: 'server-error', label: 'Server error' },
  { value: 'slow', label: 'Slow' },
]

const WORKOUT_TYPES = [
  { value: 'Running', label: 'Run' },
  { value: 'Traditional Strength Training', label: 'Strength' },
  { value: 'Functional Strength Training', label: 'HYROX' },
] as const

/** Toggle (DESIGN.md): paper with a 2px inset edge stroke; selected inverts to ink. */
const toggleClass =
  'grid min-h-11 cursor-pointer place-items-center rounded-sm px-2 text-[15px] font-bold shadow-[inset_0_0_0_2px_var(--edge)] data-focus-visible:outline-3 data-focus-visible:outline-offset-2 data-focus-visible:outline-link data-selected:bg-ink data-selected:text-paper data-selected:shadow-none'

const inputClass =
  'h-11 w-full min-w-0 rounded-sm bg-paper px-3 text-[17px] font-bold shadow-[inset_0_0_0_2px_var(--edge)] outline-none focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-link'

/** Line button (DESIGN.md): paper, 2px inset ink stroke, sinks on hover. */
const lineButtonClass =
  'min-h-11 cursor-pointer rounded-sm bg-paper px-5 text-[17px] font-bold text-ink shadow-[inset_0_0_0_2px_var(--ink)] hover:bg-sunk data-pending:cursor-wait data-focus-visible:outline-3 data-focus-visible:outline-offset-2 data-focus-visible:outline-link disabled:opacity-60'

const sectionClass = 'grid gap-2.5 border-t border-rule pt-3'
const headingClass = 'text-[18px] font-bold'
const labelClass = 'text-[15px] font-bold'

/**
 * Mock mode's mark on every screen (ADR-0005): the data here is the
 * browser's own, not the athlete's, from the scenario it names. A status tag
 * (DESIGN.md) in ink, so it reads on the cobalt field and on paper alike. It
 * hangs from the top edge, above the wordmark and clear of every control,
 * and names the network mode when it isn't Online. A tap opens the mock
 * panel: the network, and the Shortcut sends.
 */
export function MockBadge({ info }: { info: MockInfo }) {
  const { controls } = info
  const mode = useSyncExternalStore(controls.subscribe, controls.network)
  const modeLabel = NETWORK.find((n) => n.value === mode)!.label
  const title = useId()

  return (
    <aside
      aria-label="Mock data"
      className="fixed top-[env(safe-area-inset-top)] left-1/2 z-50 max-w-[calc(100vw-120px)] -translate-x-1/2"
    >
      <DialogTrigger>
        <Button className="block max-w-full cursor-pointer truncate rounded-b-sm bg-ink px-2 py-1 text-label leading-4 tracking-[0.08em] text-paper uppercase data-focus-visible:outline-3 data-focus-visible:outline-offset-2 data-focus-visible:outline-link">
          Mock · <span className="tracking-normal normal-case">{info.scenario}</span>
          {info.unknown !== null && (
            <span className="tracking-normal normal-case">, no scenario “{info.unknown}”</span>
          )}
          {mode !== 'online' && ` · ${modeLabel}`}
        </Button>
        {/* With no Dialog inside, the Popover is the dialog, its hidden Dismiss buttons included. */}
        <Popover
          aria-labelledby={title}
          placement="bottom"
          offset={8}
          className="max-h-[calc(100dvh-48px)] w-[min(340px,calc(100vw-32px))] overflow-y-auto rounded-sm border-2 border-ink bg-paper p-[14px] text-ink shadow-[0_10px_30px_rgba(0,0,0,.18)] outline-none"
        >
          <div className="grid gap-3">
            <div>
              <Heading id={title} level={2} className={headingClass}>
                Mock panel
              </Heading>
              <PinnedToday controls={controls} />
            </div>
            <Segmented
              label="Network"
              value={mode}
              options={NETWORK}
              onChange={controls.setNetwork}
              className="[&>div]:grid [&>div]:grid-cols-2"
            />
            <NightForm controls={controls} />
            <WorkoutForm controls={controls} />
          </div>
        </Popover>
      </DialogTrigger>
    </aside>
  )
}

/** Read as the panel opens, not when the badge first rendered: the clock may have been pinned since. */
function PinnedToday({ controls }: { controls: MockControls }) {
  return <p className="text-[15px] text-muted">Mock data. Today is {longDay(controls.today())}.</p>
}

function NightForm({ controls }: { controls: MockControls }) {
  const [night, setNight] = useState<NightFields>(controls.defaults.night)
  const set = (patch: Partial<NightFields>) => setNight((n) => ({ ...n, ...patch }))
  return (
    <Send label="Send Recovery night" onSend={() => controls.sendNight(night)}>
      <Heading level={2} className={headingClass}>
        Recovery night
      </Heading>
      <div className="grid grid-cols-3 gap-2">
        <Field label="Sleep, min" value={night.sleepMinutes} min={1} max={1440} onChange={(v) => set({ sleepMinutes: v ?? 1 })} />
        <Field label="HRV, ms" value={night.hrvMs} min={1} max={300} onChange={(v) => set({ hrvMs: v })} />
        <Field label="Rest HR" value={night.restingHeartRate} min={20} max={150} onChange={(v) => set({ restingHeartRate: v })} />
      </div>
      <Checkbox
        isSelected={night.baseline}
        onChange={(baseline) => set({ baseline })}
        className={`${toggleClass} justify-items-start px-3 text-left`}
      >
        Fill the 7 nights before with normal ones
      </Checkbox>
    </Send>
  )
}

function WorkoutForm({ controls }: { controls: MockControls }) {
  const [workout, setWorkout] = useState<WorkoutFields>(controls.defaults.workout)
  const set = (patch: Partial<WorkoutFields>) => setWorkout((w) => ({ ...w, ...patch }))
  const run = workout.type === 'Running'
  return (
    <Send
      label="Send Apple Watch workout"
      onSend={() => controls.sendWorkout({ ...workout, distanceKm: run ? workout.distanceKm : null })}
    >
      <Heading level={2} className={headingClass}>
        Apple Watch workout
      </Heading>
      <RadioGroup value={workout.type} onChange={(type) => set({ type })} className="grid gap-2">
        <Label className={labelClass}>Type</Label>
        <div className="grid grid-cols-3 gap-1.5">
          {WORKOUT_TYPES.map((t) => (
            <Radio key={t.value} value={t.value} className={toggleClass}>
              {t.label}
            </Radio>
          ))}
        </div>
      </RadioGroup>
      <div className="grid grid-cols-2 gap-2">
        <TextField
          value={workout.start}
          onChange={(start) => set({ start })}
          validate={(v) => (/^([01]\d|2[0-3]):[0-5]\d$/.test(v) ? null : 'HH:MM')}
          className="grid gap-1"
        >
          <Label className={labelClass}>Start</Label>
          <Input inputMode="numeric" className={inputClass} />
        </TextField>
        <Field label="Minutes" value={workout.minutes} min={1} max={600} onChange={(v) => set({ minutes: v ?? 1 })} />
        {run && (
          <Field
            label="Distance, km"
            value={workout.distanceKm}
            min={0.1}
            max={100}
            step={0.01}
            onChange={(v) => set({ distanceKm: v })}
          />
        )}
        <Field
          label="Avg HR"
          value={workout.averageHeartRate}
          min={40}
          max={240}
          onChange={(v) => set({ averageHeartRate: v ?? 150 })}
        />
      </div>
    </Send>
  )
}

/** A section with its send button, and a line on what the send did. */
function Send({ label, onSend, children }: { label: string; onSend: () => Promise<SendOutcome>; children: ReactNode }) {
  const [pending, setPending] = useState(false)
  const [outcome, setOutcome] = useState<SendOutcome | null>(null)
  return (
    <section className={sectionClass}>
      {children}
      <Button
        isPending={pending}
        className={lineButtonClass}
        onPress={async () => {
          setPending(true)
          setOutcome(null)
          try {
            setOutcome(await onSend())
          } catch (error) {
            setOutcome({ ok: false, message: error instanceof Error ? error.message : String(error) })
          } finally {
            setPending(false)
          }
        }}
      >
        {pending ? 'Sending…' : label}
      </Button>
      <p role="status" className={`text-[15px] empty:hidden ${outcome?.ok === false ? 'text-alert' : 'text-muted'}`}>
        {outcome?.message}
      </p>
    </section>
  )
}

function Field({
  label,
  value,
  min,
  max,
  step = 1,
  onChange,
}: {
  label: string
  value: number | null
  min: number
  max: number
  step?: number
  onChange: (value: number | null) => void
}) {
  return (
    <NumberField
      value={value ?? NaN}
      onChange={(v) => onChange(Number.isNaN(v) ? null : v)}
      minValue={min}
      maxValue={max}
      step={step}
      formatOptions={{ maximumFractionDigits: 2, useGrouping: false }}
      className="grid gap-1"
    >
      <Label className={labelClass}>{label}</Label>
      <Input inputMode={step < 1 ? 'decimal' : 'numeric'} className={inputClass} />
    </NumberField>
  )
}
