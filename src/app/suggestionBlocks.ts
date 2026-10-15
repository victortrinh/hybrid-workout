/**
 * Today's Suggestions as blocks: one per Suggestion, except the Working weight
 * ones, which come as a single lift block. The Coach has one answer for the
 * day; a stack of eleven buttons isn't one.
 */
import { daysBetween, type LocalDate } from '../domain/calendar'
import { LIFT_NAME } from '../domain/program/describe'
import type { Suggestion, WorkingWeightSuggestion } from '../domain/suggestion'
import type { HeldIncrease } from '../domain/weights'
import { list } from './coachCopy'
import { shortDay } from './format'

export type SuggestionBlock =
  | { kind: 'one'; suggestion: Suggestion }
  | { kind: 'lifts'; lifts: WorkingWeightSuggestion[] }

/** Blocks shown above This Week; the rest wait behind "more from the Coach". */
export const VISIBLE_BLOCKS = 2

/** What matters most first: pain, then last night, then the Week, then the lifts. */
const ORDER: Record<Suggestion['kind'], number> = { pain: 0, recovery: 1, 're-entry': 2, 'working-weight': 3 }

/** Open Suggestions, and those decided today so Undo stays one tap away, most important first. */
export function suggestionBlocks(suggestions: Suggestion[], today: LocalDate): SuggestionBlock[] {
  const shown = suggestions
    .filter((s) => s.decision === 'open' || s.decidedOn === today)
    .sort((a, b) => ORDER[a.kind] - ORDER[b.kind])
  const lifts = shown.filter((s): s is WorkingWeightSuggestion => s.kind === 'working-weight')
  return [
    ...shown.filter((s) => s.kind !== 'working-weight').map((suggestion) => ({ kind: 'one' as const, suggestion })),
    ...(lifts.length === 1 ? [{ kind: 'one' as const, suggestion: lifts[0] }] : []),
    ...(lifts.length > 1 ? [{ kind: 'lifts' as const, lifts }] : []),
  ]
}

const WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten']
const count = (n: number) => WORDS[n] ?? String(n)
const capital = (text: string) => text[0].toUpperCase() + text.slice(1)

/** "+5 lb", or "+5 to +10 lb" when the steps differ. */
function steps(lifts: WorkingWeightSuggestion[]): string {
  const sizes = lifts.map((s) => Math.abs(s.to.pounds - s.from.pounds))
  const [low, high] = [Math.min(...sizes), Math.max(...sizes)]
  return low === high ? `+${low} lb` : `+${low} to +${high} lb`
}

const isUp = (s: WorkingWeightSuggestion) => s.to.pounds > s.from.pounds

export interface LiftsCopy {
  /** The change and the reason, while any lift is Open. */
  line: string
  /** Which lifts, from which Week. */
  why: string
  /** Once none is Open: what was decided. */
  decided: string
}

export function liftsCopy(lifts: WorkingWeightSuggestion[]): LiftsCopy {
  const up = lifts.filter(isUp)
  const down = lifts.length - up.length
  const all = lifts.length === 2 ? 'both' : `all ${count(lifts.length)}`
  const topRpe = Math.max(...lifts.map((s) => s.trigger.topRpe))
  const line =
    down === 0
      ? `Lifts: ${steps(lifts).includes(' to ') ? `up on ${all}, ${steps(lifts)}` : `${steps(lifts)} on ${all}`}. Every rep, nothing past RPE ${topRpe}. Those were warm-ups.`
      : up.length === 0
        ? `Lifts: ${count(down)} held twice in a row. Back off 5%, then build again.`
        : `Lifts: ${count(up.length)} up, ${count(down)} down. Easy ones climb, grinders back off.`
  const weeks = [...new Set(lifts.map((s) => s.week))].sort((a, b) => a - b)

  const accepted = lifts.filter((s) => s.decision === 'accepted').length
  const kept = lifts.filter((s) => s.decision === 'kept').length
  const moved = down === 0 ? 'heavier' : 'moved'
  const decided =
    kept === 0
      ? `Done. ${capital(count(accepted))} lifts ${moved}. Same face, more plates.`
      : accepted === 0
        ? `All ${count(kept)} stay put. Your call. They’ll still be light.`
        : `${capital(count(accepted))} ${moved}, ${count(kept)} kept. Your call.`

  return {
    line,
    why: `Week ${list(weeks.map(String))}: ${list(lifts.map((s) => LIFT_NAME[s.lift]))}`,
    decided,
  }
}

/** One lift in the open list: "Squat 185 → 190 lb". */
export const liftChange = (s: WorkingWeightSuggestion) => `${LIFT_NAME[s.lift]} ${s.from.pounds} → ${s.to.pounds} lb`

/** The one Coach line while increases wait out a lighter Week. */
export function heldCopy(held: HeldIncrease[], today: LocalDate): { line: string; why: string } {
  const lifts = held.map((h) => h.suggestion)
  const landsOn = held.map((h) => h.landsOn).sort()[0]
  const who = lifts.length === 1 ? LIFT_NAME[lifts[0].lift] : 'Lifts'
  const weeks = daysBetween(today, landsOn) > 7 ? 'Weeks' : 'Week'
  return {
    line: `${who} earned ${steps(lifts)}. It lands after the lighter ${weeks}.`,
    why: `From ${shortDay(landsOn)}: ${lifts.map((s) => `${LIFT_NAME[s.lift]} ${s.to.pounds} lb`).join(' · ')}`,
  }
}
