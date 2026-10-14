import { useState } from 'react'
import { Button } from 'react-aria-components'
import { isRising, PAIN_AREA_LABEL, painLevel, type PainArea, type PainReport } from '../../domain/pain'
import { painLine } from '../coachCopy'
import { lineAction, primaryAction, quietButton } from './actions'
import { answered, PainFields, type PainAnswer } from './PainFields'

/** The pain step's answer at Start: "Gone" (or nothing standing) is a score of 0. */
export interface PainAtStart {
  score: number
  area: PainArea | null
  /** The pain Suggestion it triggers, decided on the spot; null when it triggers none. */
  decision: 'accepted' | 'kept' | null
  /** Off to the Live session, or back to Today when the Session became an easy day. */
  start: boolean
}

/** Nothing hurts, as far as anyone knows: Start goes straight to the Live session. */
export const PAIN_FREE: PainAtStart = { score: 0, area: null, decision: null, start: true }

/**
 * Whether Start needs the pain step: only when the standing Pain report says
 * something hurt. Otherwise the 0 stands and Start is one tap.
 */
export const asksPain = (standing: PainReport | null) => standing !== null && standing.score > 0

/**
 * Still hurts? Before a Live session, once a Pain report above 0 stands.
 * Gone records a 0 and starts. Same keeps the report; Changed asks how bad and
 * where. Either way the Coach says what it makes of it, and the Session starts
 * with that, or as written, or (from pain 5) settles for the easy day.
 */
export function PainStep({
  standing,
  onAnswer,
  onCancel,
}: {
  /** The report standing now, above 0: what Same repeats and "rising" compares against. */
  standing: PainReport
  onAnswer: (pain: PainAtStart) => void
  onCancel: () => void
}) {
  const [stage, setStage] = useState<'still' | 'same' | 'changed'>('still')
  const [answer, setAnswer] = useState<PainAnswer>({ score: null, area: null })
  const given: PainAnswer = stage === 'same' ? { score: standing.score, area: standing.area } : answer
  const level = given.score === null ? null : painLevel(given.score, standing.score)
  const area = standing.area ? PAIN_AREA_LABEL[standing.area] : 'Pain'

  function same() {
    // Nothing the pain rules act on: start, with the report repeated.
    if (painLevel(standing.score, standing.score) === null) {
      onAnswer({ score: standing.score, area: standing.area, decision: null, start: true })
    } else {
      setStage('same')
    }
  }

  return (
    <section aria-labelledby="pain-step-heading">
      <h2 id="pain-step-heading" className="text-title">
        {stage === 'changed' ? 'How is it now?' : 'Still hurts?'}
      </h2>
      {stage === 'still' && (
        <>
          <p className="mt-1 text-body-quiet text-muted">
            {area} {standing.score} last time. One tap: pain changes what the Coach lets you do.
          </p>
          <div className="mt-3 grid grid-cols-3 gap-2.5">
            <Button autoFocus onPress={() => onAnswer({ ...PAIN_FREE })} className={primaryAction}>
              Gone
            </Button>
            <Button onPress={same} className={lineAction}>
              Same
            </Button>
            <Button onPress={() => setStage('changed')} aria-expanded={false} className={lineAction}>
              Changed
            </Button>
          </div>
        </>
      )}
      {stage === 'changed' && (
        <div className="mt-3 grid gap-5">
          <PainFields value={answer} onChange={setAnswer} />
        </div>
      )}
      {stage !== 'still' && answered(given) && (
        <div aria-live="polite" className="mt-4 grid gap-3">
          <p className="text-[17px] leading-[1.3] font-semibold">
            {painLine(given.score, level, isRising(given.score, standing.score))}
          </p>
          <div className="flex flex-wrap gap-2.5">
            {level === null ? (
              <Button onPress={() => onAnswer({ ...given, decision: null, start: true })} className={primaryAction}>
                Start session
              </Button>
            ) : (
              <>
                <Button
                  onPress={() => onAnswer({ ...given, decision: 'accepted', start: level === 'ease' })}
                  className={primaryAction}
                >
                  {level === 'ease' ? 'Start with that' : 'Take the easy day'}
                </Button>
                <Button onPress={() => onAnswer({ ...given, decision: 'kept', start: true })} className={lineAction}>
                  Start as written
                </Button>
              </>
            )}
          </div>
        </div>
      )}
      <Button onPress={onCancel} className={`mt-1 ${quietButton}`}>
        Not now
      </Button>
    </section>
  )
}
