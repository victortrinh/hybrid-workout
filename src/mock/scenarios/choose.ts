import { DEFAULT_SCENARIO, findScenario } from './index'

/** The scenario this tab is on, kept in session storage between reloads. */
export interface Current {
  name: string
  /** A `?scenario=` that named no scenario, so the default stood in. */
  unknown: string | null
}

/**
 * Which scenario to run, and whether to load it fresh: always for a
 * `?scenario=` (even the one already loaded, which resets it), and for a tab
 * with none yet. Otherwise the tab carries on with what it has.
 */
export function chooseScenario(asked: string | null, stored: Current | null): Current & { fresh: boolean } {
  if (asked !== null) {
    const found = findScenario(asked)
    return { name: found?.name ?? DEFAULT_SCENARIO, unknown: found ? null : asked, fresh: true }
  }
  if (stored && findScenario(stored.name)) return { ...stored, fresh: false }
  return { name: DEFAULT_SCENARIO, unknown: null, fresh: true }
}
