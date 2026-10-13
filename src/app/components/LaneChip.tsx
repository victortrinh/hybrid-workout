import type { Lane } from '../../domain/program/types'

const LANE_COLOR: Record<Lane, string> = {
  speed: 'text-speed',
  strength: 'text-strength',
  threshold: 'text-threshold',
  hyrox: 'text-hyrox',
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
