import type { Program } from '../../domain/program/types'
import { EmptyState } from '../components/EmptyState'

/** Progress: charts of what was logged. Nothing is logged yet, so it says so. */
export function Progress({ program }: { program: Program }) {
  const firstTest = program.phases.flatMap((p) => p.weeks).find((w) => w.fiveKTest)
  return (
    <div className="px-pad pt-6 desktop:max-w-progress desktop:px-gutter desktop:pt-9">
      <h1 tabIndex={-1} className="text-headline-page">
        Progress
      </h1>
      <p className="mt-1 text-body-quiet text-muted">
        5K tests against 20:00, weekly completion, Training load, paces, Working weights and recovery.
      </p>
      <EmptyState title="Nothing logged yet, so nothing to chart.">
        {firstTest
          ? `The baseline 5K test is Week ${firstTest.number}. The 20:00 line can wait until then.`
          : 'Charts start with the first Session log.'}
      </EmptyState>
    </div>
  )
}
