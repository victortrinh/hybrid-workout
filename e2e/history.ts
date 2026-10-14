import type { APIRequestContext, Page } from '@playwright/test'

export interface SeedLog {
  week: number
  sessionId: string
  date: string
  status: 'done' | 'partial' | 'skipped' | 'swapped'
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

/** Answers /api/state with this history alone, for screens that don't write anything. */
export async function serveHistory(page: Page, logs: SeedLog[]) {
  await page.route('/api/state', (route) =>
    route.fulfill({ json: { sessionLogs: logs.map((l) => toLog(l, 'served')), suggestionDecisions: [] } }),
  )
}

/** Every Session of a Week but the Optional one, Done on `date`: nothing carried, nothing Skipped. */
export const weekDone = (week: number, sessionIds: string[], date: string): SeedLog[] =>
  sessionIds.map((sessionId) => ({ week, sessionId, date, status: 'done' }))
