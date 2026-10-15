import { createContext, useContext, useSyncExternalStore, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

/** Where a screen's ActionBar docks on the phone: just above the tab bar. */
export const DockContext = createContext<HTMLElement | null>(null)

const DESKTOP = '(min-width: 60rem)'

function subscribe(onChange: () => void) {
  const query = window.matchMedia(DESKTOP)
  query.addEventListener('change', onChange)
  return () => query.removeEventListener('change', onChange)
}

/** The desktop breakpoint, matched live: the side rail's layout, no thumb to serve. */
export function useDesktop(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(DESKTOP).matches,
    () => false,
  )
}

/** The bar's look wherever it sits: paper, an ink rule above, the safe area below. */
export const actionBarClass = 'border-t-2 border-ink bg-paper px-pad pt-3 pb-3'

/**
 * A screen's one primary action, docked above the tab bar on the phone so the
 * thumb finds it without scrolling. On desktop it stays where the screen put it.
 */
export function ActionBar({ children, label }: { children: ReactNode; label: string }) {
  const dock = useContext(DockContext)
  const desktop = useDesktop()
  if (desktop || !dock) {
    return (
      <section aria-label={label} className="mt-5">
        {children}
      </section>
    )
  }
  return createPortal(
    // A landmark of its own: it sits outside main, beside the tab bar.
    <section aria-label={label} className={`${actionBarClass} max-h-[70dvh] overflow-y-auto`}>
      {children}
    </section>,
    dock,
  )
}
