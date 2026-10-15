import { describe, expect, it } from 'vitest'
import { localDate } from './calendar'
import { coach } from './coach'
import type { LoggedStatus, SessionLog, SetLog } from './log'
import { program } from './program/program'
import type { LiftId } from './program/types'
import type { Decision, SuggestionDecision } from './suggestion'
import { calibrated, increase, reduced, strengthState } from './weights'

/** Each Week's Strength session, done on its Wednesday. */
const WEDNESDAY: Record<number, string> = {
  1: '2026-10-21',
  2: '2026-10-28',
  3: '2026-11-04',
  4: '2026-11-11',
  5: '2026-11-18',
  6: '2026-11-25',
  7: '2026-12-02',
  15: '2027-01-27',
  26: '2027-04-14',
}

type SetSpec = [pounds: number, reps: number, rpe: number]

/** A Strength session log with these sets per lift, in the order given. */
function strength(week: number, lifts: Partial<Record<LiftId, SetSpec[]>>, status: LoggedStatus = 'done'): SessionLog {
  const sets: SetLog[] = Object.entries(lifts).flatMap(([lift, specs], exercise) =>
    specs!.map(([pounds, reps, rpe], i) => ({ exercise, set: i + 1, lift: lift as LiftId, pounds, reps, rpe })),
  )
  return {
    id: `strength-w${week}`,
    week,
    sessionId: 'strength',
    date: localDate(WEDNESDAY[week]),
    status,
    minutes: 45,
    rpe: 7,
    notes: null,
    resultSeconds: null,
    environment: null,
    distanceMeters: null,
    intervals: [],
    stations: [],
    sets,
    updatedAt: `${WEDNESDAY[week]}T20:00:00.000Z`,
  }
}

const three = (pounds: number, reps: number, rpe: number): SetSpec[] => [
  [pounds, reps, rpe],
  [pounds, reps, rpe],
  [pounds, reps, rpe],
]

/** Week 1's calibration: squat ramped to RPE 7 at 185 lb, RDL to 135 lb. */
const CALIBRATION = strength(1, {
  'back-squat': [
    [135, 5, 5],
    [165, 5, 6],
    [185, 5, 7],
  ],
  'romanian-deadlift': [
    [95, 6, 5],
    [115, 6, 6],
    [135, 6, 7],
  ],
  'single-leg-calf-raise': [
    [25, 8, 6],
    [35, 8, 7],
    [45, 8, 8],
  ],
})

const decide = (id: string, decision: Decision, date = '2026-11-01'): SuggestionDecision => ({
  id,
  decision,
  date: localDate(date),
  updatedAt: `${date}T12:00:00.000Z`,
})

const state = (logs: SessionLog[], decisions: SuggestionDecision[] = [], today = '2027-04-20') =>
  strengthState(program, logs, decisions, localDate(today))

describe('calibration', () => {
  it('takes the heaviest set at RPE 7 or easier as each lift’s Working weight', () => {
    const { weights, changes, suggestions } = state([CALIBRATION])
    expect(weights).toEqual({ 'back-squat': 185, 'romanian-deadlift': 135, 'single-leg-calf-raise': 35 })
    expect(changes.map((c) => [c.lift, c.pounds, c.reason])).toEqual([
      ['back-squat', 185, 'calibration'],
      ['romanian-deadlift', 135, 'calibration'],
      ['single-leg-calf-raise', 35, 'calibration'],
    ])
    expect(suggestions).toEqual([])
  })

  it('starts 5% under the lightest set when every set overshot', () => {
    expect(calibrated([{ exercise: 0, set: 1, lift: 'back-squat', pounds: 200, reps: 5, rpe: 9 }])).toBe(190)
  })

  it('has no Working weights before anything is logged, or for a log in the future', () => {
    expect(state([]).weights).toEqual({})
    expect(state([CALIBRATION], [], '2026-10-20').weights).toEqual({})
  })

  it('calibrates a lift in its first Strength session when Week 1 found no weight for it', () => {
    const { weights, suggestions } = state([strength(3, { 'back-squat': three(165, 5, 7) })])
    expect(weights).toEqual({ 'back-squat': 165 })
    expect(suggestions).toEqual([])
  })
})

describe('increase', () => {
  const easyWeek2 = strength(2, {
    'back-squat': three(185, 5, 7),
    'romanian-deadlift': three(135, 6, 6),
    'single-leg-calf-raise': three(35, 8, 7),
  })

  it('suggests +5 lb on squat and RDL and +5% on calves when every target rep was RPE 7 or easier', () => {
    const { weights, suggestions } = state([CALIBRATION, easyWeek2], [], '2026-11-05')
    expect(suggestions.map((s) => [s.id, s.lift, s.from.pounds, s.to.pounds, s.trigger.reason, s.decision])).toEqual([
      ['ww-back-squat-w2', 'back-squat', 185, 190, 'all-reps-easy', 'open'],
      ['ww-romanian-deadlift-w2', 'romanian-deadlift', 135, 140, 'all-reps-easy', 'open'],
      ['ww-single-leg-calf-raise-w2', 'single-leg-calf-raise', 35, 40, 'all-reps-easy', 'open'],
    ])
    expect(suggestions[0].trigger).toEqual({ reason: 'all-reps-easy', weeks: [2], sets: 3, reps: 5, pounds: 185, topRpe: 7 })
    // Never applied silently.
    expect(weights).toEqual({ 'back-squat': 185, 'romanian-deadlift': 135, 'single-leg-calf-raise': 35 })
  })

  it('moves the Working weight once Accepted, and not when Kept', () => {
    const accepted = state([CALIBRATION, easyWeek2], [decide('ww-back-squat-w2', 'accepted')], '2026-11-05')
    expect(accepted.weights['back-squat']).toBe(190)
    expect(accepted.suggestions[0]).toMatchObject({ decision: 'accepted', decidedOn: '2026-11-01' })
    expect(accepted.changes.at(-1)).toEqual({
      lift: 'back-squat',
      week: 2,
      date: '2026-10-28',
      pounds: 190,
      reason: 'all-reps-easy',
    })
    expect(state([CALIBRATION, easyWeek2], [decide('ww-back-squat-w2', 'kept')]).weights['back-squat']).toBe(185)
  })

  it('rounds the calves’ 5% to the nearest 5 lb, and never adds less than 5 lb', () => {
    expect(increase('single-leg-calf-raise', 35)).toBe(5)
    expect(increase('seated-calf-raise-machine', 150)).toBe(10)
    expect(increase('seated-calf-raise', 250)).toBe(15)
    expect(increase('back-squat', 300)).toBe(5)
  })

  it('leaves the weight alone at RPE 8, or when the Session was cut short', () => {
    const rpe8 = strength(2, { 'back-squat': [[185, 5, 7], [185, 5, 8], [185, 5, 7]] })
    expect(state([CALIBRATION, rpe8]).suggestions).toEqual([])
    const partial = strength(2, { 'back-squat': three(185, 5, 6) }, 'partial')
    expect(state([CALIBRATION, partial]).suggestions).toEqual([])
  })

  it('lets an undecided Suggestion lapse once the lift is logged again', () => {
    const week3 = strength(3, { 'back-squat': three(185, 5, 8) })
    expect(state([CALIBRATION, easyWeek2, week3]).suggestions.map((s) => s.lift)).not.toContain('back-squat')
    expect(state([CALIBRATION, easyWeek2, week3]).weights['back-squat']).toBe(185)
  })

  it('progresses from the accepted weight the next time', () => {
    const week3 = strength(3, { 'back-squat': three(190, 5, 7) })
    const { suggestions } = state([CALIBRATION, easyWeek2, week3], [decide('ww-back-squat-w2', 'accepted')], '2026-11-05')
    expect(suggestions.find((s) => s.lift === 'back-squat')).toMatchObject({ from: { pounds: 190 }, to: { pounds: 195 } })
  })
})

describe('a lighter Week', () => {
  // Week 4 (Mon 9 – Sun 15 Nov) is a Deload week; Week 5 starts Mon 16 Nov.
  const easyWeek3 = strength(3, { 'back-squat': three(185, 5, 7), 'romanian-deadlift': three(135, 6, 6) })

  it('offers an increase while the Week is full volume', () => {
    const { suggestions, held } = state([CALIBRATION, easyWeek3], [], '2026-11-05')
    expect(suggestions.map((s) => [s.lift, s.decision])).toEqual([
      ['back-squat', 'open'],
      ['romanian-deadlift', 'open'],
    ])
    expect(held).toEqual([])
  })

  it('holds an open increase through a Deload week, then applies it the Monday after', () => {
    const deload = state([CALIBRATION, easyWeek3], [], '2026-11-10')
    expect(deload.suggestions).toEqual([])
    expect(deload.held.map((h) => [h.suggestion.id, h.suggestion.to.pounds, h.landsOn])).toEqual([
      ['ww-back-squat-w3', 190, '2026-11-16'],
      ['ww-romanian-deadlift-w3', 140, '2026-11-16'],
    ])
    expect(deload.weights).toEqual({ 'back-squat': 185, 'romanian-deadlift': 135, 'single-leg-calf-raise': 35 })

    const after = state([CALIBRATION, easyWeek3], [], '2026-11-16')
    expect(after.held).toEqual([])
    expect(after.suggestions).toEqual([])
    expect(after.weights).toMatchObject({ 'back-squat': 190, 'romanian-deadlift': 140 })
    expect(after.changes.at(-1)).toEqual({
      lift: 'romanian-deadlift',
      week: 3,
      date: '2026-11-16',
      pounds: 140,
      reason: 'all-reps-easy',
    })
  })

  it('keeps a held increase through the lighter Week’s own Strength session', () => {
    const deload = strength(4, { 'back-squat': [[160, 5, 5], [160, 5, 5]] })
    expect(state([CALIBRATION, easyWeek3, deload], [], '2026-11-12').held).toHaveLength(2)
    expect(state([CALIBRATION, easyWeek3, deload], [], '2026-11-17').weights['back-squat']).toBe(190)
  })

  it('leaves a decided increase alone: Kept stays kept, Accepted already moved', () => {
    const decisions = [decide('ww-back-squat-w3', 'kept'), decide('ww-romanian-deadlift-w3', 'accepted')]
    const { weights, held } = state([CALIBRATION, easyWeek3], decisions, '2026-11-10')
    expect(held).toEqual([])
    expect(weights).toMatchObject({ 'back-squat': 185, 'romanian-deadlift': 140 })
    expect(state([CALIBRATION, easyWeek3], decisions, '2026-11-20').weights['back-squat']).toBe(185)
  })

  it('treats a Week made lighter by an accepted re-entry the same way', () => {
    const easyWeek5 = strength(5, { 'back-squat': three(185, 5, 7) })
    const lightened = (today: string) => strengthState(program, [CALIBRATION, easyWeek5], [], localDate(today), [6])
    expect(lightened('2026-11-20').suggestions.map((s) => s.id)).toEqual(['ww-back-squat-w5'])
    expect(lightened('2026-11-23').held.map((h) => h.landsOn)).toEqual(['2026-11-30'])
    expect(lightened('2026-11-30').weights['back-squat']).toBe(190)
  })

  it('holds an increase earned during the lighter Week until the Week after', () => {
    const easyWeek6 = strength(6, { 'back-squat': three(185, 5, 6) })
    const { suggestions, held } = strengthState(program, [CALIBRATION, easyWeek6], [], localDate('2026-11-26'), [6])
    expect(suggestions).toEqual([])
    expect(held.map((h) => [h.suggestion.id, h.landsOn])).toEqual([['ww-back-squat-w6', '2026-11-30']])
  })
})

describe('hold and reduction', () => {
  const hard = (week: number) => strength(week, { 'back-squat': [[185, 5, 8], [185, 5, 9], [185, 5, 9]] })
  const missed = (week: number) => strength(week, { 'back-squat': [[185, 5, 8], [185, 4, 8], [185, 3, 8]] })

  it('holds at RPE 9 or more, or with missed reps: no Suggestion the first time', () => {
    expect(state([CALIBRATION, hard(2)]).suggestions).toEqual([])
    expect(state([CALIBRATION, missed(2)]).suggestions).toEqual([])
    expect(state([CALIBRATION, hard(2)]).weights['back-squat']).toBe(185)
  })

  it('suggests −5%, to the nearest 5 lb, after two holds in a row', () => {
    const { suggestions } = state([CALIBRATION, hard(2), missed(3)])
    expect(suggestions).toHaveLength(1)
    expect(suggestions[0]).toMatchObject({
      id: 'ww-back-squat-w3',
      from: { pounds: 185 },
      to: { pounds: 175 },
      trigger: { reason: 'two-holds', weeks: [2, 3], topRpe: 8, reps: 3 },
    })
  })

  it('counts a set lighter than the Working weight as a hold', () => {
    const lighter = (week: number) => strength(week, { 'back-squat': three(175, 5, 7) })
    expect(state([CALIBRATION, lighter(2), lighter(3)]).suggestions[0]).toMatchObject({ to: { pounds: 175 } })
  })

  it('needs the holds in a row: an RPE 8 Session between them starts the count again', () => {
    const steady = strength(3, { 'back-squat': three(185, 5, 8) })
    expect(state([CALIBRATION, hard(2), steady, hard(5)]).suggestions).toEqual([])
  })

  it('starts counting again after a reduction, whatever was decided', () => {
    const logs = [CALIBRATION, hard(2), hard(3), hard(5)]
    expect(state(logs, [decide('ww-back-squat-w3', 'kept')]).suggestions).toEqual([])
    expect(state([...logs, hard(6)], [decide('ww-back-squat-w3', 'accepted')]).suggestions[0]).toMatchObject({
      from: { pounds: 175 },
      to: { pounds: 165 },
      trigger: { weeks: [5, 6] },
    })
  })

  it('reduces by at least 5 lb and never below 5 lb', () => {
    expect(reduced(185)).toBe(175)
    expect(reduced(40)).toBe(35)
    expect(reduced(5)).toBe(5)
  })

  it('ignores Deload and Taper sets: they neither progress nor break a run of holds', () => {
    const deload = strength(4, { 'back-squat': [[160, 5, 5], [160, 5, 5]] })
    expect(state([CALIBRATION, hard(2), hard(3)]).suggestions).toHaveLength(1)
    expect(state([CALIBRATION, hard(3), deload, hard(5)]).suggestions[0]).toMatchObject({ trigger: { weeks: [3, 5] } })
    expect(state([CALIBRATION, strength(26, { 'back-squat': three(110, 3, 4) })]).weights['back-squat']).toBe(185)
  })
})

describe('the Coach', () => {
  const easyWeek2 = strength(2, { 'back-squat': three(185, 5, 7) })

  it('shows each lift’s Working weight and its open Suggestion on Today', () => {
    const day = coach({ program, today: localDate('2026-10-29'), logs: [CALIBRATION, easyWeek2] })
    expect(day.workingWeights['back-squat']).toBe(185)
    expect(day.suggestions.filter((s) => s.kind === 'working-weight').map((s) => s.id)).toEqual(['ww-back-squat-w2'])
  })

  it('reads a Substitution’s sets on their own lift, whatever the Equipment profile says now', () => {
    const machine = strength(1, { 'standing-calf-raise-machine': [[90, 8, 7]] })
    const day = coach({ program, today: localDate('2026-10-29'), logs: [machine], equipment: ['calf-machine'] })
    expect(day.workingWeights).toEqual({ 'standing-calf-raise-machine': 90 })
  })
})
