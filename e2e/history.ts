import type { APIRequestContext, Page } from '@playwright/test'

export interface SeedLog {
  week: number
  sessionId: string
  date: string
  status: 'done' | 'partial' | 'skipped' | 'swapped'
  /** A 5K test's time, which sets the Training paces. */
  resultSeconds?: number
  environment?: 'indoor' | 'outdoor'
}

const toLog = (seed: SeedLog, project: string) => ({
  ...seed,
  id: `e2e-${project}-w${seed.week}-${seed.sessionId}`,
  minutes: 45,
  rpe: seed.status === 'skipped' ? null : 6,
  notes: null,
  updatedAt: `${seed.date}T20:00:00.000Z`,
})

/** Writes Session logs to the shared e2e database, with ids that are the same on every run. */
export async function seedLogs(request: APIRequestContext, project: string, logs: SeedLog[]) {
  const response = await request.post('/api/sync', { data: { sessionLogs: logs.map((l) => toLog(l, project)) } })
  if (!response.ok()) throw new Error(`Seeding failed: ${response.status()} ${await response.text()}`)
}

/**
 * Answers /api/state and /api/sync with this history, plus whatever the page
 * syncs, without touching the shared database. Returns the logs the page
 * sends, latest last, for tests that check what was saved.
 */
export async function serveHistory(page: Page, logs: SeedLog[]): Promise<Record<string, unknown>[]> {
  const sent: Record<string, unknown>[] = []
  const history = logs.map((l) => toLog(l, 'served'))
  await page.route(/\/api\/(state|sync)$/, (route) => {
    if (route.request().method() === 'POST') sent.push(...(route.request().postDataJSON().sessionLogs ?? []))
    return route.fulfill({ json: { sessionLogs: [...history, ...sent], suggestionDecisions: [] } })
  })
  return sent
}

/** Every Session of a Week but the Optional one, Done on `date`: nothing carried, nothing Skipped. */
export const weekDone = (week: number, sessionIds: string[], date: string): SeedLog[] =>
  sessionIds.map((sessionId) => ({ week, sessionId, date, status: 'done' }))
