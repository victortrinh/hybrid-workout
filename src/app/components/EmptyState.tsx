import type { ReactNode } from 'react'

/** The one filled block on paper: a sunk panel for "nothing here yet". */
export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="mt-3 rounded-sm bg-sunk p-[18px]">
      <p className="text-body">{title}</p>
      {children && <p className="mt-1 text-body-quiet text-muted">{children}</p>}
    </div>
  )
}
