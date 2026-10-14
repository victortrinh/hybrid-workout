/**
 * The Coach's words for a Suggestion, from its facts. Blunt, a little funny,
 * and always with the number and the reason (PRODUCT.md, Coach voice).
 */
import { LIFT_NAME, SESSION_TYPES } from '../domain/program/describe'
import type { Suggestion } from '../domain/suggestion'
import { plural } from './format'

export interface SuggestionCopy {
  /** The change and the reason, while it is Open. */
  line: string
  /** The facts behind it, in a quieter line. */
  why: string
  /** The Keep button: what stays if the athlete says no. */
  keep: string
  /** After Accept. */
  accepted: string
  /** After Keep. */
  kept: string
}

export function suggestionCopy(s: Suggestion): SuggestionCopy {
  switch (s.kind) {
    case 're-entry': {
      const cut = s.from.volumePercent - s.to.volumePercent
      const skipped = s.trigger.skipped.map((x) => SESSION_TYPES[x.type].name)
      return {
        line: `${plural(skipped.length, 'Session')} skipped last Week. Full volume now is how calves file complaints. Week ${s.week} goes ${cut}% lighter.`,
        why: `Week ${s.trigger.week}: ${list(skipped)} skipped · every Prescription this Week at ${s.to.volumePercent}%`,
        keep: 'Keep full volume',
        accepted: `Done. Week ${s.week} is ${cut}% lighter. Ease in, then get greedy again.`,
        kept: 'Keeping full volume. Your call. Your calves.',
      }
    }
    case 'working-weight': {
      const lift = LIFT_NAME[s.lift]
      const from = `${s.from.pounds} lb`
      const to = `${s.to.pounds} lb`
      const step = `${s.to.pounds > s.from.pounds ? '+' : '−'}${Math.abs(s.to.pounds - s.from.pounds)} lb`
      const { trigger } = s
      if (trigger.reason === 'all-reps-easy') {
        return {
          line: `${lift}: every rep, nothing harder than RPE ${trigger.topRpe}. ${from} was a warm-up. ${to} next time.`,
          why: `Week ${s.week}: ${trigger.sets} × ${trigger.reps} at ${from}, top RPE ${trigger.topRpe} · ${step}`,
          keep: `Keep ${from}`,
          accepted: `${lift} is ${to} now. Same face, more plates.`,
          kept: `${lift} stays ${from}. Your call. It’ll still be light.`,
        }
      }
      return {
        line: `${lift} held twice in a row. Grinding isn’t progress. Back to ${to}, then build again.`,
        why: `Weeks ${list(trigger.weeks.map(String))}: RPE 9 or more, or reps missed · −5%, ${step}`,
        keep: `Keep ${from}`,
        accepted: `${lift} is ${to} now. Clean reps first.`,
        kept: `${lift} stays ${from}. Make the reps count.`,
      }
    }
  }
}

/** "Speed", "Speed and HYROX", "Speed, Strength and HYROX" */
function list(items: string[]): string {
  return items.length <= 1 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`
}
