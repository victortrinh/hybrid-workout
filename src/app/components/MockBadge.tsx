import { useId, useSyncExternalStore } from 'react'
import { Button, DialogTrigger, Heading, Popover } from 'react-aria-components'
import type { MockControls, NetworkMode } from '../../mock/controls'
import { longDay } from '../format'
import type { MockInfo } from '../mockInfo'
import { Segmented } from './Segmented'

const NETWORK: readonly { value: NetworkMode; label: string }[] = [
  { value: 'online', label: 'Online' },
  { value: 'offline', label: 'Offline' },
  { value: 'server-error', label: 'Server error' },
  { value: 'slow', label: 'Slow' },
]

const headingClass = 'text-[18px] font-bold'

/**
 * Mock mode's mark on every screen (ADR-0005): the data here is the
 * browser's own, not the athlete's, from the scenario it names. A status tag
 * (DESIGN.md) in ink, so it reads on the cobalt field and on paper alike. It
 * hangs from the top edge, above the wordmark and clear of every control,
 * and names the network mode when it isn't Online. A tap opens the mock
 * panel: the network.
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
