import { clock } from '../../domain/paces'
import type { Program } from '../../domain/program/types'
import { ROXZONE_SECONDS, type RacePlan } from '../../domain/racePlan'
import { nb } from '../format'
import { finishClock, raceLoadWords, raceNotes, sourceLine } from '../raceCopy'

const rowClass = 'grid grid-cols-[28px_1fr_auto] items-baseline gap-x-3 border-b border-rule py-3'

/**
 * The race card that leads Today the day before Race day and on it: one
 * answer (the finish estimate, or that there's nothing to estimate from),
 * then the race in order as rows, then the Coach's notes. Rows like a
 * receipt, so the night before it reads at a glance.
 */
export function RaceCard({ plan, program, raceDay }: { plan: RacePlan; program: Program; raceDay: boolean }) {
  const { stations } = program
  const missing = plan.legs.filter((l) => !l.split).map((l) => stations[l.station].name)
  const none = plan.simulations.length === 0
  const answer = none
    ? sourceLine(plan)
    : plan.finish !== null
      ? `Finish around ${finishClock(plan.finish)}.`
      : missing.length > 0
        ? `No finish estimate: ${listOf(missing)} never timed.`
        : 'No finish estimate: no run timed in a Race simulation.'

  return (
    <section
      className="px-pad pt-5 desktop:col-span-full desktop:grid desktop:grid-cols-2 desktop:gap-x-12 desktop:px-0 desktop:pt-7"
    >
      <div>
        <h1 id="today-heading" tabIndex={-1} className="text-headline">
          {raceDay ? 'Race day.' : 'Race tomorrow.'}
        </h1>
        <p className="mt-2 text-prescription">{nb(answer)}</p>
        {!none && <p className="mt-1 text-body-quiet text-muted">{nb(sourceLine(plan))}</p>}

        <ol aria-label="The race, in order" className="mt-[18px] border-t-2 border-ink">
          <li className={rowClass}>
            <span aria-hidden="true" />
            <Leg
              name="Runs"
              detail={plan.run ? `8 × 1 km at ${clock(plan.run.secondsPerKm)}/km` : '8 × 1 km, one before each Station'}
            />
            <Split seconds={plan.run ? 8 * plan.run.secondsPerKm : null} />
          </li>
          {plan.legs.map(({ station: id, split }) => {
            const station = stations[id]
            return (
              <li key={id} className={rowClass}>
                <span className="text-[20px] leading-none font-black font-stretch-125%">{station.order}</span>
                <Leg name={station.name} detail={raceLoadWords(station)} />
                <Split seconds={split?.seconds ?? null} note={split?.scaled ? `doubled, Week ${split.week}` : undefined} />
              </li>
            )
          })}
          {plan.finish !== null && (
            <li className={rowClass}>
              <span aria-hidden="true" />
              <Leg name="Roxzone" detail="Walking between it all. A guess." />
              <Split seconds={ROXZONE_SECONDS} />
            </li>
          )}
        </ol>
        {plan.finish !== null && (
          <p className="flex items-baseline justify-between gap-3 pt-3">
            <span className="text-[17px] font-bold">Finish, estimated</span>
            <span className="text-[26px] leading-none font-black font-stretch-125%">{finishClock(plan.finish)}</span>
          </p>
        )}
      </div>

      <section aria-labelledby="race-coach-heading" className="mt-section desktop:mt-0">
        <h2 id="race-coach-heading" className="border-t-2 border-ink pt-3.5 text-title desktop:border-t-0 desktop:pt-0">
          Coach
        </h2>
        <ul className="mt-1.5">
          {raceNotes(plan, raceDay, stations['sled-push']).map((note) => (
            <li key={note} className="border-b border-rule py-3 text-body">
              {nb(note)}
            </li>
          ))}
        </ul>
      </section>
    </section>
  )
}

function Leg({ name, detail }: { name: string; detail: string }) {
  return (
    <span>
      <span className="block text-[17px] font-bold">{name}</span>
      <span className="block text-[15px] text-muted">{nb(detail)}</span>
    </span>
  )
}

function Split({ seconds, note }: { seconds: number | null; note?: string }) {
  if (seconds === null) {
    return (
      <span className="text-[15px] text-muted">
        <span aria-hidden="true">–</span>
        <span className="sr-only">No split</span>
      </span>
    )
  }
  return (
    <span className="text-right">
      <span className="block text-[17px] font-bold">{seconds >= 3600 ? finishClock(seconds) : clock(seconds)}</span>
      {note && <span className="block text-[13px] text-muted">{note}</span>}
    </span>
  )
}

const listOf = (names: string[]) =>
  names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`
