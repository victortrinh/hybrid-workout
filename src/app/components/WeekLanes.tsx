import { SESSION_TYPES } from '../../domain/program/describe'
import type { Session } from '../../domain/program/types'
import type { CompletionState, WeekCompletion } from '../../domain/progress'
import { motion } from 'motion/react'
import { lane, useEntrances } from '../motion'
import { LANE_COLOR } from './LaneChip'

/**
 * A Week's five lanes, outlined in their Session type's colour, taller for
 * the Key session. Done fills a lane, Partial half-fills it, and Skipped or
 * missed fades it. A Week not yet started passes no states and stays outlined.
 * Decorative: the row says the same in its label.
 */
export function WeekLanes({ cells }: { cells: { session: Session; state?: CompletionState }[] }) {
  const entrances = useEntrances()
  return (
    <span aria-hidden="true" className="grid h-[18px] grid-cols-5 items-end gap-1">
      {cells.slice(0, 5).map(({ session, state }, i) => (
        <i
          key={session.id}
          className={`relative block overflow-hidden shadow-[inset_0_0_0_2px_currentColor] ${LANE_COLOR[SESSION_TYPES[session.type].lane]} ${session.key ? 'h-[18px]' : 'h-3'} ${state === 'skipped' || state === 'missed' ? 'opacity-35' : ''}`}
        >
          {(state === 'done' || state === 'partial') && (
            // Done lanes fill from the floor up, left to right, the first time the Week scrolls into view.
            <motion.b
              initial={entrances ? { scaleY: 0 } : false}
              whileInView={{ scaleY: 1 }}
              viewport={{ once: true }}
              transition={lane(0.4, i * 0.05)}
              className={`absolute inset-x-0 bottom-0 origin-bottom bg-current ${state === 'partial' ? 'h-1/2' : 'h-full'}`}
            />
          )}
        </i>
      ))}
    </span>
  )
}

/** "3 of 4 done, 1 missed": a started Week's completion, for its row's label. */
export function completionLabel(week: WeekCompletion): string {
  return `${week.done} of ${week.required} done${week.missed > 0 ? `, ${week.missed} missed` : ''}`
}
