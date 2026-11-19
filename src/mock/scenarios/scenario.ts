/**
 * A scenario: one state of the Program to QA in mock mode (ADR-0005). It
 * pins the day the app thinks it is, fills every server table, the Starting
 * point among them (skipped unless it says otherwise), and sets what
 * the device keeps: settings, Environment overrides, and a Live session left
 * running.
 */
import { localDate, type LocalDate } from '../../domain/calendar'
import type { LiveSession } from '../../domain/lifts'
import type { SessionLog } from '../../domain/log'
import type { PainReport } from '../../domain/pain'
import type { Environment } from '../../domain/paces'
import type { Settings } from '../../domain/settings'
import { SKIPPED, type StartingPoint } from '../../domain/startingPoint'
import type { SuggestionDecision } from '../../domain/suggestion'

export interface Scenario {
  /** Its `?scenario=` name. */
  name: string
  /** What it QAs, in a line, for the picker. */
  summary: string
  /** The day the app thinks it is, in America/Toronto. */
  today: LocalDate
  /** The time it is when the scenario loads, `HH:MM` in Toronto; it ticks on from there. */
  time: string
  server: {
    sessionLogs: SessionLog[]
    suggestionDecisions: SuggestionDecision[]
    painReports: PainReport[]
    /** Null for a first launch, which shows the Starting point screen; skipped unless a scenario says otherwise. */
    startingPoint: StartingPoint | null
  }
  device: {
    settings: Partial<Settings>
    /** Per-Session Environment overrides, keyed `week/sessionId`. */
    environment: Record<string, Environment>
    /** A Live session left running, started from `now`, the pinned clock at load. */
    live: ((now: number) => LiveSession) | null
  }
}

type Definition = Pick<Scenario, 'name' | 'summary'> & {
  today: string
  time?: string
  server?: Partial<Scenario['server']>
  device?: Partial<Scenario['device']>
}

export function scenario({ name, summary, today, time = '08:00', server = {}, device = {} }: Definition): Scenario {
  return {
    name,
    summary,
    today: localDate(today),
    time,
    server: {
      sessionLogs: [],
      suggestionDecisions: [],
      painReports: [],
      startingPoint: { ...SKIPPED, updatedAt: `${today}T00:00:00.000Z` },
      ...server,
    },
    device: { settings: {}, environment: {}, live: null, ...device },
  }
}
