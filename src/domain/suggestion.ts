/**
 * Suggestions: changes the Coach proposes and the athlete decides.
 *
 * A Suggestion is plain data (kind, what it changes, from and to, and the
 * facts that triggered it); the screens turn it into the Coach's words. The
 * Coach derives Suggestions from the logs every time it runs, so the only
 * thing stored is the athlete's decision, keyed by the Suggestion's id.
 */
import { localDate, type LocalDate } from './calendar'
import type { PainArea, PainLevel } from './pain'
import type { LiftId, SessionType } from './program/types'
import type { ShortSleepCut } from './recovery'

export const DECISIONS = ['open', 'accepted', 'kept'] as const

/** Open until the athlete Accepts or Keeps; Undo puts it back to Open. */
export type Decision = (typeof DECISIONS)[number]

export interface SuggestionDecision {
  /** The Suggestion's id: the same on every device, since the Coach derives it. */
  id: string
  decision: Decision
  /** The day it was decided (or undone), in America/Toronto. */
  date: LocalDate
  /** ISO instant of the decision; on sync the later one wins. */
  updatedAt: string
}

/** A lighter re-entry Week after two or more Skipped Sessions. */
export interface ReEntrySuggestion {
  id: string
  kind: 're-entry'
  /** The Week it lightens. */
  week: number
  /** The Session it changes; null for every Session of the Week. */
  sessionId: string | null
  /** The day the change applies from: the Week's Monday. */
  date: LocalDate
  /** Share of the Program's volume, in percent. */
  from: { volumePercent: number }
  to: { volumePercent: number }
  trigger: {
    /** The Week the Sessions were Skipped in. */
    week: number
    skipped: { sessionId: string; type: SessionType }[]
  }
  decision: Decision
  /** When the decision was made; null while nobody has decided. */
  decidedOn: LocalDate | null
}

/** The pain rules, for every open Session while a Pain report stands. */
export interface PainSuggestion {
  id: string
  kind: 'pain'
  /** The Week it changes: the one Today shows. */
  week: number
  /** Null: whichever Session is trained while the report stands. */
  sessionId: null
  /** The day it applies from: the day of the report. */
  date: LocalDate
  /** Bike for jumps and accelerations with fewer reps, or easy low-impact work. */
  level: PainLevel
  trigger: {
    score: number
    area: PainArea | null
    /** The report before it, when this one is higher: rising pain. */
    risingFrom: number | null
  }
  decision: Decision
  decidedOn: LocalDate | null
}

/** A short night with low HRV: today's Hard session as an easy 30′, or rest. */
export interface RecoverySuggestion {
  id: string
  kind: 'recovery'
  /** The Week of the Session it changes. */
  week: number
  /** The Hard session Up next on the morning. */
  sessionId: string
  /** The morning: the change is for this day only. */
  date: LocalDate
  /** What the short-sleep rule takes off the Session if the athlete keeps it; null when only RPE is capped. */
  cut: ShortSleepCut | null
  trigger: {
    sleepMinutes: number
    hrvMs: number
    /** The 7-night mean the HRV is compared with. */
    hrvMean: number
  }
  decision: Decision
  decidedOn: LocalDate | null
}

/** Why the Coach wants a Working weight moved. */
export type WorkingWeightReason =
  /** Every target rep at RPE 7 or easier: up. */
  | 'all-reps-easy'
  /** RPE 9 or more, or missed reps, two Strength sessions in a row: down. */
  | 'two-holds'

/** A Working weight up or down, from a Strength session's logged sets. */
export interface WorkingWeightSuggestion {
  id: string
  kind: 'working-weight'
  /** The Strength session it comes from. */
  week: number
  sessionId: string
  lift: LiftId
  /** The day that Strength session was done. */
  date: LocalDate
  from: { pounds: number }
  to: { pounds: number }
  trigger: {
    reason: WorkingWeightReason
    /** The Weeks of the Strength sessions behind it: one for an increase, the holds in a row for a reduction. */
    weeks: number[]
    /** The latest of those Sessions: sets logged, the fewest reps and the lightest load of any set, and the hardest RPE. */
    sets: number
    reps: number
    pounds: number
    topRpe: number
  }
  decision: Decision
  decidedOn: LocalDate | null
}

export type Suggestion = ReEntrySuggestion | WorkingWeightSuggestion | PainSuggestion | RecoverySuggestion

export const reEntryId = (week: number) => `re-entry-w${week}`
export const workingWeightId = (lift: LiftId, week: number) => `ww-${lift}-w${week}`
/** One per Pain report: a decision on it stands as long as the report does. */
export const painId = (reportId: string) => `pain-${reportId}`

/** One per morning: whichever Hard session is Up next that day. */
export const recoveryId = (date: LocalDate) => `recovery-${date}`

const ID = /^[a-z0-9-]{1,64}$/
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/

/** Checks an untrusted value (a request body, a stored row) and returns a clean decision. Throws on anything else. */
export function parseDecision(value: unknown): SuggestionDecision {
  if (typeof value !== 'object' || value === null) throw new Error('A Suggestion decision must be an object')
  const v = value as Record<string, unknown>
  if (typeof v.id !== 'string' || !ID.test(v.id)) throw new Error('id must be 1–64 lowercase letters, digits or -')
  if (!DECISIONS.includes(v.decision as Decision)) throw new Error(`decision must be one of ${DECISIONS.join(', ')}`)
  if (typeof v.date !== 'string') throw new Error('date must be an ISO date')
  const date = localDate(v.date)
  const updatedAt = v.updatedAt
  if (typeof updatedAt !== 'string' || !INSTANT.test(updatedAt) || Number.isNaN(Date.parse(updatedAt))) {
    throw new Error('updatedAt must be an ISO instant in UTC')
  }
  return { id: v.id, decision: v.decision as Decision, date, updatedAt }
}

/** Both sets of decisions, keeping the later one for any Suggestion in both. */
export function mergeDecisions(ours: SuggestionDecision[], theirs: SuggestionDecision[]): SuggestionDecision[] {
  const byId = new Map(ours.map((d) => [d.id, d]))
  for (const d of theirs) {
    const mine = byId.get(d.id)
    if (!mine || d.updatedAt > mine.updatedAt) byId.set(d.id, d)
  }
  return [...byId.values()]
}

export function decisionFor(decisions: SuggestionDecision[], id: string): SuggestionDecision | null {
  return decisions.find((d) => d.id === id) ?? null
}
