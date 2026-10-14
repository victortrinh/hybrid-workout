/**
 * The Coach's words for a Suggestion, from its facts. Blunt, a little funny,
 * and always with the number and the reason (PRODUCT.md, Coach voice).
 */
import { SESSION_TYPES } from '../domain/program/describe'
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
  }
}

/** "Speed", "Speed and HYROX", "Speed, Strength and HYROX" */
function list(items: string[]): string {
  return items.length <= 1 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`
}
