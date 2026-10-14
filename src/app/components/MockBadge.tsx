import type { MockInfo } from '../mockInfo'

/**
 * Mock mode's mark on every screen (ADR-0005): the data here is the
 * browser's own, not the athlete's, from the scenario it names. A status tag
 * (DESIGN.md) in ink, so it reads on the cobalt field and on paper alike. It
 * hangs from the top edge, above the wordmark and clear of every control,
 * and never takes a tap.
 */
export function MockBadge({ info }: { info: MockInfo }) {
  return (
    <aside
      aria-label="Mock data"
      className="pointer-events-none fixed top-[env(safe-area-inset-top)] left-1/2 z-50 max-w-[calc(100vw-120px)] -translate-x-1/2 truncate rounded-b-sm bg-ink px-2 py-0.5 text-label leading-4 tracking-[0.08em] text-paper uppercase"
    >
      Mock · <span className="tracking-normal normal-case">{info.scenario}</span>
      {info.unknown !== null && (
        <span className="tracking-normal normal-case">, no scenario “{info.unknown}”</span>
      )}
    </aside>
  )
}
