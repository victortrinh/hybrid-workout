import { useState } from 'react'
import { Button } from 'react-aria-components'
import { isRising, painLevel, type PainArea } from '../../domain/pain'
import { painLine } from '../coachCopy'
import { lineAction, primaryAction, quietButton } from './actions'
import { answered, PainFields, type PainAnswer } from './PainFields'

/** The pain step's answer at Start: "No" is a score of 0. */
export interface PainAtStart {
  score: number
  area: PainArea | null
  /** The pain Suggestion it triggers, decided on the spot; null when it triggers none. */
  decision: 'accepted' | 'kept' | null
  /** Off to the Live session, or back to Today when the Session became an easy day. */
  start: boolean
}

/**
 * Anything hurt? Before every Live session: "No" is one tap and starts it.
 * "Yes" asks how bad and where, says what the Coach makes of it, and starts
 * with that, or as written, or (from pain 5) settles for the easy day.
 */
export function PainStep({
  previous,
  onAnswer,
  onCancel,
}: {
  /** The score standing before this one: rising pain counts. */
  previous: number | null
  onAnswer: (pain: PainAtStart) => void
  onCancel: () => void
}) {
  const [yes, setYes] = useState(false)
  const [answer, setAnswer] = useState<PainAnswer>({ score: null, area: null })
  const level = answer.score === null ? null : painLevel(answer.score, previous)

  return (
    <section aria-labelledby="pain-step-heading" className="mt-4 border-t-2 border-ink pt-3.5">
      <h2 id="pain-step-heading" className="text-title">
        Anything hurt?
      </h2>
      <p className="mt-1 text-body-quiet text-muted">One tap. Pain changes what the Coach lets you do next.</p>
      <div className="mt-3 flex gap-2.5">
        <Button
          autoFocus
          onPress={() => onAnswer({ score: 0, area: null, decision: null, start: true })}
          className={primaryAction}
        >
          No. Let’s go
        </Button>
        <Button onPress={() => setYes(true)} aria-expanded={yes} className={lineAction}>
          Yes
        </Button>
      </div>
      {yes && (
        <div className="mt-5 grid gap-5">
          <PainFields value={answer} onChange={setAnswer} />
          {answered(answer) && (
            <div aria-live="polite" className="grid gap-3">
              <p className="text-[17px] leading-[1.3] font-semibold">
                {painLine(answer.score, level, isRising(answer.score, previous))}
              </p>
              <div className="flex flex-wrap gap-2.5">
                {level === null ? (
                  <Button onPress={() => onAnswer({ ...answer, decision: null, start: true })} className={primaryAction}>
                    Start session
                  </Button>
                ) : (
                  <>
                    <Button
                      onPress={() => onAnswer({ ...answer, decision: 'accepted', start: level === 'ease' })}
                      className={primaryAction}
                    >
                      {level === 'ease' ? 'Start with that' : 'Take the easy day'}
                    </Button>
                    <Button onPress={() => onAnswer({ ...answer, decision: 'kept', start: true })} className={lineAction}>
                      Start as written
                    </Button>
                  </>
                )}
              </div>
            </div>
          )}
        </div>
      )}
      <Button onPress={onCancel} className={`mt-2 ${quietButton}`}>
        Not now
      </Button>
    </section>
  )
}
