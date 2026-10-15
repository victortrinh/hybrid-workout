import { describe, expect, it } from 'vitest'
import { localDate } from '../../domain/calendar'
import type { PainReport } from '../../domain/pain'
import { painId, type PainSuggestion, type Suggestion } from '../../domain/suggestion'
import { painSuggestionFor, whenSame } from './PainStep'

const ACHILLES_3: PainReport = {
  id: 'r1',
  date: localDate('2026-10-14'),
  score: 3,
  area: 'achilles-calf',
  week: null,
  sessionId: null,
  updatedAt: '2026-10-14T12:00:00.000Z',
}

const suggestion = (decision: PainSuggestion['decision']): PainSuggestion => ({
  id: painId(ACHILLES_3.id),
  kind: 'pain',
  week: 3,
  sessionId: null,
  date: ACHILLES_3.date,
  level: 'ease',
  trigger: { score: 3, area: 'achilles-calf', risingFrom: 2 },
  decision,
  decidedOn: decision === 'open' ? null : localDate('2026-10-15'),
})

describe('whenSame', () => {
  it('starts at once when the pain rules have nothing to say', () => {
    expect(whenSame({ ...ACHILLES_3, score: 2 }, null)).toEqual({
      score: 2,
      area: 'achilles-calf',
      decision: null,
      start: true,
    })
  })

  it('starts at once with the decision already made, accepted or kept', () => {
    for (const decision of ['accepted', 'kept'] as const) {
      expect(whenSame(ACHILLES_3, suggestion(decision))).toEqual({
        score: 3,
        area: 'achilles-calf',
        decision,
        start: true,
      })
    }
  })

  it('asks while the pain Suggestion is still open', () => {
    expect(whenSame(ACHILLES_3, suggestion('open'))).toBe('ask')
  })
})

describe('painSuggestionFor', () => {
  it('finds the pain Suggestion of the standing report, and no other', () => {
    const ours = suggestion('open')
    const older = { ...suggestion('kept'), id: painId('r0') }
    const suggestions: Suggestion[] = [older, ours]
    expect(painSuggestionFor(suggestions, ACHILLES_3)).toBe(ours)
    expect(painSuggestionFor([older], ACHILLES_3)).toBeNull()
    expect(painSuggestionFor(suggestions, null)).toBeNull()
  })
})
