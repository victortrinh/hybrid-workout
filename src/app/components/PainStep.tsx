import { useState } from 'react'
import { Button } from 'react-aria-components'
import { isRising, PAIN_AREA_LABEL, painLevel, type PainArea, type PainReport } from '../../domain/pain'
import { painId, type PainSuggestion, type Suggestion } from '../../domain/suggestion'
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

/** The pain Suggestion the standing report triggers, if any: what Same means. */
export const painSuggestionFor = (suggestions: Suggestion[], standing: PainReport | null): PainSuggestion | null =>
  (standing &&
    suggestions.find((s): s is PainSuggestion => s.kind === 'pain' && s.id === painId(standing.id))) ??
  null

/**
 * Same, at Start: the standing report again. When the pain rules have nothing
 * to say, or its Suggestion is already decided, the Session starts with that;
 * only an open Suggestion is asked, once, here.
 */
export function whenSame(standing: PainReport, suggestion: PainSuggestion | null): PainAtStart | 'ask' {
  if (suggestion?.decision === 'open') return 'ask'
  return { score: standing.score, area: standing.area, decision: suggestion?.decision ?? null, start: true }
}

/**
 * Still hurts? Before a Live session, once a Pain report above 0 stands.
 * Gone records a 0 and starts. Same keeps the report and its Suggestion's
 * decision, so it starts too unless that Suggestion is still open. Changed asks
 * how bad and where. Then the Coach says what it makes of it, in the
 * Suggestion's own line, and the Session starts with that, or as written, or
 * (from pain 5) settles for the easy day.
 */
export function PainStep({
  standing,
  suggestion,
  onAnswer,
  onCancel,
}: {
  /** The report standing now, above 0: what Same repeats and "rising" compares against. */
  standing: PainReport
  /** The pain Suggestion it triggers, open or decided; null when it triggers none. */
  suggestion: PainSuggestion | null
  onAnswer: (pain: PainAtStart) => void
  onCancel: () => void
}) {
  const [stage, setStage] = useState<'still' | 'same' | 'changed'>('still')
  const [answer, setAnswer] = useState<PainAnswer>({ score: null, area: null })
  const given: PainAnswer = stage === 'same' ? { score: standing.score, area: standing.area } : answer
  /** The score the Coach answers, once there is one: Same's at once (with or without an area), Changed's once complete. */
  const score = stage === 'same' ? standing.score : answered(answer) ? answer.score : null
  // Same is the Suggestion as it stands; Changed is a new report, rising against this one.
  const level =
    stage === 'same' ? (suggestion?.level ?? null) : score === null ? null : painLevel(score, standing.score)
  const rising =
    stage === 'same' ? suggestion?.trigger.risingFrom != null : score !== null && isRising(score, standing.score)
  const area = standing.area ? PAIN_AREA_LABEL[standing.area] : 'Pain'

  function same() {
    const answer = whenSame(standing, suggestion)
    if (answer === 'ask') setStage('same')
    else onAnswer(answer)
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
      {stage !== 'still' && score !== null && (
        <div aria-live="polite" className="mt-4 grid gap-3">
          <p className="text-[17px] leading-[1.3] font-semibold">{painLine(score, level, rising)}</p>
          <div className="flex flex-wrap gap-2.5">
            {level === null ? (
              <Button onPress={() => onAnswer({ score, area: given.area, decision: null, start: true })} className={primaryAction}>
                Start session
              </Button>
            ) : (
              <>
                <Button
                  onPress={() => onAnswer({ score, area: given.area, decision: 'accepted', start: level === 'ease' })}
                  className={primaryAction}
                >
                  {level === 'ease' ? 'Start with that' : 'Take the easy day'}
                </Button>
                <Button onPress={() => onAnswer({ score, area: given.area, decision: 'kept', start: true })} className={lineAction}>
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
