/**
 * Session logs: what actually happened in a Session.
 *
 * The same records live in D1 and on the device. Ids are generated on the
 * device, so a log can be written before the server has seen it; on sync the
 * later `updatedAt` wins, per log.
 */
import { localDate, type LocalDate } from './calendar'
import { ENVIRONMENTS, FIVE_K_SECONDS, type Environment } from './paces'
import type { SuggestionDecision } from './suggestion'

export const LOGGED_STATUSES = ['done', 'partial', 'skipped', 'swapped'] as const

/** A Session status once something is logged; Planned is the absence of a log. */
export type LoggedStatus = (typeof LOGGED_STATUSES)[number]

export interface SessionLog {
  id: string
  /** The Program Session it logs: its Week number and its id within that Week. */
  week: number
  sessionId: string
  /** The day it was done (or skipped), in America/Toronto. */
  date: LocalDate
  status: LoggedStatus
  minutes: number | null
  /** Overall RPE, 1–10. */
  rpe: number | null
  notes: string | null
  /** A 5K test's time in seconds; it sets the Training paces. Null for every other Session. */
  resultSeconds: number | null
  /** Where a run happened. Recorded with each 5K test result. */
  environment: Environment | null
  /** ISO instant of the last edit. */
  updatedAt: string
}

/** Everything the device needs from the server. More records join as they arrive. */
export interface SyncState {
  sessionLogs: SessionLog[]
  suggestionDecisions: SuggestionDecision[]
}

export const NOTES_MAX = 2000
const ID = /^[A-Za-z0-9_-]{8,64}$/
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/

/** Trained that day: counts toward the spacing rules. Skipped and Swapped don't. */
export const trained = (log: SessionLog) => log.status === 'done' || log.status === 'partial'

/** Checks an untrusted value (a request body, a stored row) and returns a clean log. Throws on anything else. */
export function parseSessionLog(value: unknown): SessionLog {
  if (typeof value !== 'object' || value === null) throw new Error('A Session log must be an object')
  const v = value as Record<string, unknown>

  const id = v.id
  if (typeof id !== 'string' || !ID.test(id)) throw new Error('id must be 8–64 letters, digits, - or _')
  const week = v.week
  if (!Number.isInteger(week) || (week as number) < 1) throw new Error('week must be a positive whole number')
  const sessionId = v.sessionId
  if (typeof sessionId !== 'string' || sessionId.length === 0 || sessionId.length > 64) {
    throw new Error('sessionId must be a short string')
  }
  if (typeof v.date !== 'string') throw new Error('date must be an ISO date')
  const date = localDate(v.date)
  const status = v.status
  if (!LOGGED_STATUSES.includes(status as LoggedStatus)) {
    throw new Error(`status must be one of ${LOGGED_STATUSES.join(', ')}`)
  }
  const minutes = optionalInteger(v.minutes, 'minutes', 1, 600)
  const rpe = optionalInteger(v.rpe, 'rpe', 1, 10)
  const notes = v.notes ?? null
  if (notes !== null && (typeof notes !== 'string' || notes.length > NOTES_MAX)) {
    throw new Error(`notes must be text of at most ${NOTES_MAX} characters`)
  }
  const resultSeconds = optionalInteger(v.resultSeconds, 'resultSeconds', ...FIVE_K_SECONDS)
  const environment = v.environment ?? null
  if (environment !== null && !ENVIRONMENTS.includes(environment as Environment)) {
    throw new Error(`environment must be one of ${ENVIRONMENTS.join(', ')}`)
  }
  const updatedAt = v.updatedAt
  if (typeof updatedAt !== 'string' || !INSTANT.test(updatedAt) || Number.isNaN(Date.parse(updatedAt))) {
    throw new Error('updatedAt must be an ISO instant in UTC')
  }

  return {
    id,
    week: week as number,
    sessionId,
    date,
    status: status as LoggedStatus,
    minutes,
    rpe,
    notes: notes === null || notes.trim() === '' ? null : notes,
    resultSeconds,
    environment: environment as Environment | null,
    updatedAt,
  }
}

function optionalInteger(value: unknown, name: string, min: number, max: number): number | null {
  if (value === undefined || value === null) return null
  if (!Number.isInteger(value) || (value as number) < min || (value as number) > max) {
    throw new Error(`${name} must be a whole number from ${min} to ${max}`)
  }
  return value as number
}

/** Both sets of logs, keeping the later edit of any log present in both. */
export function mergeLogs(ours: SessionLog[], theirs: SessionLog[]): SessionLog[] {
  const byId = new Map(ours.map((log) => [log.id, log]))
  for (const log of theirs) {
    const mine = byId.get(log.id)
    if (!mine || log.updatedAt > mine.updatedAt) byId.set(log.id, log)
  }
  return [...byId.values()]
}

/** The log that stands for a Session: the latest edit among its logs, or null while it's Planned. */
export function logFor(logs: SessionLog[], week: number, sessionId: string): SessionLog | null {
  let latest: SessionLog | null = null
  for (const log of logs) {
    if (log.week !== week || log.sessionId !== sessionId) continue
    if (!latest || log.updatedAt > latest.updatedAt) latest = log
  }
  return latest
}
