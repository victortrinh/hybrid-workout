import type { RunContext } from '../../domain/paces'
import { describeExercise } from '../../domain/program/describe'
import type { Session, Station, StationId } from '../../domain/program/types'
import type { WorkingWeights } from '../../domain/weights'
import { nb } from '../format'

/**
 * A Session's Prescription, Block by Block: each Exercise with its targets
 * from the run context and Working weights, and its Substitutions. Shown on
 * the Week page and in Today's Session sheet.
 */
export function Prescription({
  id,
  session,
  stations,
  run,
  weights,
}: {
  id?: string
  session: Session
  stations: Record<StationId, Station>
  run?: RunContext
  weights?: WorkingWeights
}) {
  const lines = session.blocks.map((block) =>
    block.exercises.map((exercise) => describeExercise(exercise, stations, run, weights)),
  )
  // A Substitution shared by several Exercises reads once, after the Block of the last of them.
  const users = new Map<string, { names: string[]; block: number }>()
  lines.forEach((block, i) => {
    for (const line of block) {
      for (const sub of line.substitutions) {
        users.set(sub, { names: [...(users.get(sub)?.names ?? []), line.name], block: i })
      }
    }
  })
  return (
    <div id={id}>
      {session.blocks.map((block, i) => (
        <div key={`${block.name}-${i}`} className="mt-7">
          <h3 className="flex items-baseline justify-between gap-3 text-title-sm">
            {block.name}
            {block.minutes !== undefined && (
              <small className="text-body-quiet tracking-normal text-muted font-stretch-100%">{block.minutes} min</small>
            )}
          </h3>
          <ul className="mt-1.5">
            {lines[i].map((line, j) => (
              <li key={`${line.name}-${j}`} className="border-b border-rule py-3">
                {/* The name carries the weight; the numbers read by tabular figures, not boldness. */}
                <span className="block text-body font-bold">
                  {line.name}
                  {line.detail && <span className="font-normal"> · {nb(line.detail)}</span>}
                </span>
                {line.note && <span className="mt-0.5 block text-body-quiet text-muted">{line.note}</span>}
                {line.substitutions
                  .filter((sub) => users.get(sub)!.names.length === 1)
                  .map((sub) => (
                    <span key={sub} className="mt-2 block border-l-2 border-edge pl-3 text-body-quiet text-muted">
                      Instead, if {lowerFirst(sub)}
                    </span>
                  ))}
              </li>
            ))}
          </ul>
          {block.note && <p className="mt-3 text-body-quiet text-muted">{block.note}</p>}
          {[...users]
            .filter(([, use]) => use.names.length > 1 && use.block === i)
            .map(([sub, use]) => (
              <p key={sub} className="mt-3 border-l-2 border-edge pl-3 text-body-quiet text-muted">
                Instead of {listWords(use.names)}, if {lowerFirst(sub)}
              </p>
            ))}
        </div>
      ))}
    </div>
  )
}

const lowerFirst = (text: string) => `${text.charAt(0).toLowerCase()}${text.slice(1)}`

/** "Pogo jumps, Broad jumps and Accelerations" */
const listWords = (names: string[]) =>
  names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
