/**
 * Mock mode's mark on every screen (ADR-0005): the data here is the
 * browser's own, not the athlete's. A status tag (DESIGN.md) in ink, so it
 * reads on the cobalt field and on paper alike. It hangs from the top edge,
 * above the wordmark and clear of every control, and never takes a tap.
 */
export function MockBadge() {
  return (
    <aside
      aria-label="Mock data"
      className="pointer-events-none fixed top-[env(safe-area-inset-top)] left-1/2 z-50 -translate-x-1/2 rounded-b-sm bg-ink px-2 py-0.5 text-label leading-4 tracking-[0.08em] text-paper uppercase"
    >
      Mock
    </aside>
  )
}
