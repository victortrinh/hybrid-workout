import type { Program } from '../../domain/program/types'
import { EmptyState } from '../components/EmptyState'
import { longDay } from '../format'

/** Plan: all 27 Weeks as lanes, once the whole Program is encoded. Honest about what's in so far. */
export function Plan({ program }: { program: Program }) {
  const encoded = program.phases.flatMap((p) => p.weeks.map((w) => w.number))
  const span = encoded.length > 1 ? `Weeks ${encoded[0]}–${encoded.at(-1)}` : `Week ${encoded[0]}`
  return (
    <div className="px-pad pt-6 desktop:max-w-plan desktop:px-gutter desktop:pt-9">
      <h1 tabIndex={-1} className="text-headline-page">
        Plan
      </h1>
      <p className="mt-1 text-body-quiet text-muted">
        {program.weekCount} Weeks to {longDay(program.raceDay)}.
      </p>
      <EmptyState title={`Only ${span} are in the app so far.`}>
        The other {program.weekCount - encoded.length} Weeks land here as lanes, grouped by Phase, once
        they’re in. Today already runs on {span}.
      </EmptyState>
    </div>
  )
}
