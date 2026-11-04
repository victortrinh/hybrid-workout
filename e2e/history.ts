import type { APIRequestContext, Page } from '@playwright/test'
// The same shapes mock mode's scenarios are written in (src/mock/scenarios).
import { toLog, type SeedLog } from '../src/mock/scenarios/seed'
import { findWeek } from '../src/domain/coach'
import { program } from '../src/domain/program/program'

export { weekDone, type SeedLog } from '../src/mock/scenarios/seed'

/** Swapped logs for each required Session of Weeks 1 to `week` that `logs` leave unlogged. */
function settling(week: number, logs: { week: number; sessionId: string }[]): SeedLog[] {
  return Array.from({ length: week }, (_, i) => findWeek(program, i + 1)!).flatMap((w) =>
    w.sessions
      .filter((s) => !s.optional && !s.date && !logs.some((l) => l.week === w.number && l.sessionId === s.id))
      .map((s): SeedLog => ({ week: w.number, sessionId: s.id, date: w.startDate, status: 'swapped' })),
  )
}

/**
 * `logs`, with every Week through `week` caught up: each required Session
 * they leave unlogged is Swapped on its Week's Monday, so none is a Late
 * session (ADR-0007) and none moves a Working weight or a Training pace.
 */
export const caughtUp = (week: number, logs: SeedLog[] = []): SeedLog[] => [...settling(week, logs), ...logs]

/**
 * For tests on the shared database: the server's answers, with every Week
 * through `week` caught up as `caughtUp` does it. Nothing is written, so
 * other tests' Weeks stay as they left them. The answers are fetched outside
 * the page, where `setOffline` doesn't reach: set `offline` alongside it.
 */
export async function caughtUpOnServer(page: Page, week: number): Promise<{ offline: boolean }> {
  const network = { offline: false }
  await page.route(/\/api\/(state|sync)$/, async (route) => {
    if (network.offline) return route.abort('internetdisconnected')
    try {
      const response = await route.fetch()
      const state = await response.json()
      const extra = settling(week, state.sessionLogs).map((l) => toLog(l, 'e2e-caught-up'))
      await route.fulfill({ response, json: { ...state, sessionLogs: [...extra, ...state.sessionLogs] } })
    } catch {
      // The page moved on before the answer came.
      await route.abort().catch(() => {})
    }
  })
  return network
}

/** What else the server holds: decisions on Suggestions, and nights from the morning Shortcut. */
export interface SeedExtras {
  suggestionDecisions?: Record<string, unknown>[]
  recoveryNights?: Record<string, unknown>[]
}

/** Writes Session logs to the shared e2e database, with ids that are the same on every run. */
export async function seedLogs(request: APIRequestContext, project: string, logs: SeedLog[]) {
  const response = await request.post('/api/sync', { data: { sessionLogs: logs.map((l) => toLog(l, `e2e-${project}`)) } })
  if (!response.ok()) throw new Error(`Seeding failed: ${response.status()} ${await response.text()}`)
}

/**
 * Answers /api/state and /api/sync with this history, plus whatever the page
 * syncs, without touching the shared database. Returns the logs the page
 * sends, latest last, for tests that check what was saved. Decisions on
 * Suggestions the page sends are served back, as the server would, and so is
 * the last Starting point sent.
 */
export async function serveHistory(
  page: Page,
  logs: SeedLog[],
  /** Where to put the Pain reports the page sends, for tests that check them. */
  painReports: Record<string, unknown>[] = [],
  { suggestionDecisions = [], recoveryNights = [] }: SeedExtras = {},
): Promise<Record<string, unknown>[]> {
  const sent: Record<string, unknown>[] = []
  const history = logs.map((l) => toLog(l, 'e2e-served'))
  let startingPoint: unknown = null
  await page.route(/\/api\/(state|sync)$/, (route) => {
    if (route.request().method() === 'POST') {
      const body = route.request().postDataJSON()
      sent.push(...(body.sessionLogs ?? []))
      painReports.push(...(body.painReports ?? []))
      startingPoint = body.startingPoint ?? startingPoint
      // The latest decision on a Suggestion stands, as the server keeps it.
      for (const d of body.suggestionDecisions ?? []) {
        const i = suggestionDecisions.findIndex((o) => o.id === d.id)
        if (i >= 0) suggestionDecisions.splice(i, 1)
        suggestionDecisions.push(d)
      }
    }
    return route.fulfill({
      json: { sessionLogs: [...history, ...sent], suggestionDecisions, painReports, recoveryNights, startingPoint },
    })
  })
  return sent
}
