import { useState } from 'react'
import { Button } from 'react-aria-components'
import { isLiveRun } from '../../domain/live'
import type { PainReport } from '../../domain/pain'
import type { Environment } from '../../domain/paces'
import type { Session } from '../../domain/program/types'
import type { PainSuggestion } from '../../domain/suggestion'
import { primaryAction, quietButton } from './actions'
import { asksPain, PAIN_FREE, PainStep, type PainAtStart } from './PainStep'
import { Segmented } from './Segmented'

/**
 * Whether Start asks where the run happens: a Session that is only running
 * (Speed, Threshold, Easy run, 5K test). Strength, HYROX and Race simulations
 * start as they always have.
 */
export const asksWhere = (session: Session) => isLiveRun(session)

/** Whether Start asks anything before the Live session: the pain step, where, or both. */
export const asksAtStart = (session: Session, standing: PainReport | null) => asksPain(standing) || asksWhere(session)

/**
 * What Start asks before the clock starts: the pain step when pain stands,
 * then, for a run that is still starting, Treadmill or outside. The Session's
 * own Environment is chosen already, so confirming is one tap. The answer is
 * null when nothing asked where.
 */
export function StartStep({
  session,
  standing,
  suggestion,
  environment,
  onStart,
  onCancel,
}: {
  session: Session
  /** The Pain report standing now: above 0, the pain step asks first. */
  standing: PainReport | null
  suggestion: PainSuggestion | null
  /** The Session's Environment as it stands: its override, else the month's default. */
  environment: Environment
  onStart: (pain: PainAtStart, environment: Environment | null) => void
  onCancel: () => void
}) {
  const [pain, setPain] = useState<PainAtStart | null>(() => (asksPain(standing) ? null : { ...PAIN_FREE }))
  if (!pain && standing) {
    return (
      <PainStep
        standing={standing}
        suggestion={suggestion}
        // An easy day instead starts nothing, so there's nowhere to ask about.
        onAnswer={(answer) => (answer.start && asksWhere(session) ? setPain(answer) : onStart(answer, null))}
        onCancel={onCancel}
      />
    )
  }
  return <WhereStep environment={environment} onAnswer={(where) => onStart(pain ?? { ...PAIN_FREE }, where)} onCancel={onCancel} />
}

/** Treadmill or outside? The Session's Environment comes chosen; Start session takes it. */
function WhereStep({
  environment,
  onAnswer,
  onCancel,
}: {
  environment: Environment
  onAnswer: (environment: Environment) => void
  onCancel: () => void
}) {
  const [where, setWhere] = useState(environment)
  return (
    <section aria-labelledby="where-step-heading">
      <h2 id="where-step-heading" className="text-title">
        Treadmill or outside?
      </h2>
      <p className="mt-1 text-body-quiet text-muted">It sets how targets read: belt speed on the treadmill, pace per km outside.</p>
      <Segmented
        label="Treadmill or outside?"
        labelClassName="sr-only"
        className="mt-3 max-w-72"
        value={where}
        options={[
          { value: 'indoor', label: 'Treadmill' },
          { value: 'outdoor', label: 'Outside' },
        ]}
        onChange={setWhere}
        autoFocus
      />
      <div className="mt-3 flex gap-2.5">
        <Button onPress={() => onAnswer(where)} className={primaryAction}>
          Start session
        </Button>
      </div>
      <Button onPress={onCancel} className={`mt-1 ${quietButton}`}>
        Not now
      </Button>
    </section>
  )
}
