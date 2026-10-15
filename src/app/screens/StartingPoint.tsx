import { Button } from 'react-aria-components'
import { SKIPPED, type StartingPoint as Point } from '../../domain/startingPoint'
import { StartingPointFields, type StartingFields } from '../components/StartingPointFields'

const EMPTY: StartingFields = {
  fiveK: { value: null, real: false },
  lifts: { 'back-squat': { value: null, real: false }, 'romanian-deadlift': { value: null, real: false } },
}

/**
 * The Starting point, once, at first launch: an estimated 5K time and
 * estimated Working weights, each optional. Anything left empty, or Skip,
 * gives RPE-only runs and calibrations from the bar. Settings edits it after.
 */
export function StartingPoint({ onSave }: { onSave: (estimates: Omit<Point, 'updatedAt'>) => void }) {
  return (
    <div className="px-pad pt-5 pb-10 desktop:mx-auto desktop:max-w-plan desktop:px-gutter desktop:pt-12">
      <p className="text-label text-muted">Starting point</p>
      <h1 tabIndex={-1} className="mt-1 text-headline">
        Where are you starting from?
      </h1>
      <p className="mt-2 text-body">
        Two estimates, both optional, so the first weeks aren’t guesswork. A real 5K test or calibration always
        replaces them, and you can change them in Settings until then.
      </p>
      <div className="mt-6 border-t-2 border-ink pt-4">
        <StartingPointFields fields={EMPTY} onSave={onSave} saveLabel="Save and start">
          <Button
            onPress={() => onSave(SKIPPED)}
            className="inline-grid min-h-[54px] cursor-pointer place-items-center rounded-sm px-5 text-[17px] font-bold text-ink shadow-[inset_0_0_0_2px_var(--ink)] hover:bg-sunk data-focus-visible:outline-3 data-focus-visible:outline-offset-2 data-focus-visible:outline-link"
          >
            Skip both
          </Button>
        </StartingPointFields>
      </div>
    </div>
  )
}
