import type { APIRequestContext, Page } from '@playwright/test'
// The same shapes mock mode's scenarios are written in (src/mock/scenarios).
import { toLog, type SeedLog } from '../src/mock/scenarios/seed'

export { weekDone, type SeedLog } from '../src/mock/scenarios/seed'

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
