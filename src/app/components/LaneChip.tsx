import type { Lane } from '../../domain/program/types'

/** The five lanes in Bucket order; the Compromised run test sits where the Run it replaces does. */
export const LANES: Lane[] = ['hyrox', 'run', 'test', 'strength', 'easy']

export const LANE_NAME: Record<Lane, string> = {
  hyrox: 'HYROX',
  run: 'Run',
  test: 'Compromised run test',
  strength: 'Strength',
  easy: 'Easy run',
}

/** The Compromised run test takes Track Red (the `speed` token), the Run Burnt Orange (`threshold`): DESIGN.md. */
export const LANE_COLOR: Record<Lane, string> = {
  hyrox: 'text-hyrox',
  run: 'text-threshold',
  test: 'text-speed',
  strength: 'text-strength',
  easy: 'text-easy',
}

/** Five stacked 3px bars in a Session type's colour. Decorative: the row names the type. */
export function LaneChip({ lane }: { lane: Lane }) {
  return (
    <span className={`grid w-9 gap-[3px] ${LANE_COLOR[lane]}`} aria-hidden="true">
      {[0, 1, 2, 3, 4].map((i) => (
        <b key={i} className="h-[3px] bg-current" />
      ))}
    </span>
  )
}

/** A key to the five lane colours, for the Plan and the Training load chart. */
export function LaneLegend() {
  return (
    <ul aria-label="Session types" className="mt-3 flex flex-wrap gap-x-3.5 gap-y-1.5 text-label text-muted">
      {LANES.map((lane) => (
        <li key={lane} className="flex items-center gap-1.5">
          <i aria-hidden="true" className={`inline-block h-1.5 w-3.5 bg-current ${LANE_COLOR[lane]}`} />
          {LANE_NAME[lane]}
        </li>
      ))}
    </ul>
  )
}
