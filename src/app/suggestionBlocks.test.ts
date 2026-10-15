import { describe, expect, it } from 'vitest'
import { localDate } from '../domain/calendar'
import type { LiftId } from '../domain/program/types'
import type { Decision, Suggestion, WorkingWeightSuggestion } from '../domain/suggestion'
import { heldCopy, liftsCopy, suggestionBlocks, VISIBLE_BLOCKS } from './suggestionBlocks'

const TODAY = localDate('2026-11-30')

function lift(id: LiftId, from: number, to: number, decision: Decision = 'open', decidedOn: string | null = null): WorkingWeightSuggestion {
  return {
    id: `ww-${id}-w5`,
    kind: 'working-weight',
    week: 5,
    sessionId: 'strength',
    lift: id,
    date: localDate('2026-11-18'),
    from: { pounds: from },
    to: { pounds: to },
    trigger: { reason: to > from ? 'all-reps-easy' : 'two-holds', weeks: [5], sets: 3, reps: 5, pounds: from, topRpe: 7 },
    decision,
    decidedOn: decidedOn === null ? null : localDate(decidedOn),
  }
}

const reEntry: Suggestion = {
  id: 're-entry-w7',
  kind: 're-entry',
  week: 7,
  sessionId: null,
  date: TODAY,
  from: { volumePercent: 100 },
  to: { volumePercent: 67 },
  trigger: { week: 6, skipped: [] },
  decision: 'open',
  decidedOn: null,
}

const pain: Suggestion = {
  id: 'pain-1',
  kind: 'pain',
  week: 7,
  sessionId: null,
  date: TODAY,
  level: 'ease',
  trigger: { score: 3, area: null, risingFrom: null },
  decision: 'open',
  decidedOn: null,
}

const FIVE = [
  lift('back-squat', 185, 190),
  lift('romanian-deadlift', 135, 140),
  lift('bulgarian-split-squat', 40, 45),
  lift('single-leg-calf-raise', 35, 40),
  lift('seated-calf-raise', 90, 95),
]

describe('Suggestion blocks on Today', () => {
  it('groups every lift into one block, after the lighter Week', () => {
    const blocks = suggestionBlocks([reEntry, ...FIVE], TODAY)
    expect(blocks.map((b) => b.kind)).toEqual(['one', 'lifts'])
    expect(blocks[1].kind === 'lifts' && blocks[1].lifts).toHaveLength(5)
  })

  it('shows a single lift as its own Suggestion', () => {
    expect(suggestionBlocks([FIVE[0]], TODAY)).toEqual([{ kind: 'one', suggestion: FIVE[0] }])
  })

  it('puts pain first, and leaves out what was decided before today', () => {
    const old = lift('back-squat', 185, 190, 'accepted', '2026-11-20')
    const blocks = suggestionBlocks([reEntry, old, FIVE[1], pain], TODAY)
    expect(blocks.map((b) => (b.kind === 'one' ? b.suggestion.id : 'lifts'))).toEqual(['pain-1', 're-entry-w7', 'ww-romanian-deadlift-w5'])
    expect(VISIBLE_BLOCKS).toBe(2)
  })

  it('keeps a lift decided today in its block, for Undo', () => {
    const blocks = suggestionBlocks([lift('back-squat', 185, 190, 'accepted', '2026-11-30'), FIVE[1]], TODAY)
    expect(blocks).toHaveLength(1)
    expect(blocks[0].kind).toBe('lifts')
  })
})

describe('the grouped lift copy', () => {
  it('says the one step on all of them', () => {
    expect(liftsCopy(FIVE).line).toBe('Lifts: +5 lb on all five. Every rep, nothing past RPE 7. Those were warm-ups.')
    expect(liftsCopy(FIVE).why).toBe('Week 5: Squat, RDL, Bulgarian split squat, Single-leg calf raise and Loaded seated calf raise')
  })

  it('gives the range when the steps differ', () => {
    const lifts = [lift('back-squat', 185, 190), lift('seated-calf-raise-machine', 150, 160)]
    expect(liftsCopy(lifts).line).toBe('Lifts: up on both, +5 to +10 lb. Every rep, nothing past RPE 7. Those were warm-ups.')
  })

  it('counts ups and downs when they mix', () => {
    const lifts = [lift('back-squat', 185, 190), lift('romanian-deadlift', 135, 125)]
    expect(liftsCopy(lifts).line).toBe('Lifts: one up, one down. Easy ones climb, grinders back off.')
  })

  it('says what was decided once nothing is open', () => {
    const accepted = FIVE.map((s) => ({ ...s, decision: 'accepted' as const }))
    expect(liftsCopy(accepted).decided).toBe('Done. Five lifts heavier. Same face, more plates.')
    const kept = FIVE.map((s) => ({ ...s, decision: 'kept' as const }))
    expect(liftsCopy(kept).decided).toBe('All five stay put. Your call. They’ll still be light.')
    const mixed = [accepted[0], kept[1], kept[2]]
    expect(liftsCopy(mixed).decided).toBe('One heavier, two kept. Your call.')
  })
})

describe('the held increases line', () => {
  const held = (lifts: WorkingWeightSuggestion[], landsOn = '2026-12-07') =>
    lifts.map((suggestion) => ({ suggestion, landsOn: localDate(landsOn) }))

  it('says what was earned and when it lands', () => {
    const copy = heldCopy(held(FIVE.slice(0, 2)), TODAY)
    expect(copy.line).toBe('Lifts earned +5 lb. It lands after the lighter Week.')
    expect(copy.why).toBe('From Mon 7 Dec: Squat 190 lb · RDL 140 lb')
  })

  it('names a lone lift, a range, and lighter Weeks back to back', () => {
    expect(heldCopy(held([FIVE[0]]), TODAY).line).toBe('Squat earned +5 lb. It lands after the lighter Week.')
    const lifts = [lift('back-squat', 185, 190), lift('seated-calf-raise-machine', 150, 160)]
    expect(heldCopy(held(lifts, '2026-12-14'), TODAY).line).toBe('Lifts earned +5 to +10 lb. It lands after the lighter Weeks.')
  })
})
