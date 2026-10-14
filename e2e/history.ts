import type { APIRequestContext, Page } from '@playwright/test'

export interface SeedLog {
  week: number
  sessionId: string
  date: string
  status: 'done' | 'partial' | 'skipped' | 'swapped'
  minutes?: number
  rpe?: number
  /** A 5K test's time in seconds, and where it was run. */
  resultSeconds?: number
  environment?: 'indoor' | 'outdoor'
  /** A Strength session's sets: what the Coach reads for the Working weights. */
  sets?: { exercise: number; set: number; lift: string | null; pounds: number | null; reps: number; rpe: number }[]
  /** A HYROX session's rounds or a Race simulation's splits. */
  stations?: { round: number; part: string; pounds: number | null; meters: number | null; reps: number | null; seconds: number | null }[]
}

/** What else the server holds: decisions on Suggestions, and nights from the morning Shortcut. */
export interface SeedExtras {
  suggestionDecisions?: Record<string, unknown>[]
  recoveryNights?: Record<string, unknown>[]
}

/** A log as the server answers it: every field there, none missing. */
const toLog = (seed: SeedLog, project: string) => ({
  minutes: 45,
  rpe: seed.status === 'skipped' ? null : 6,
  resultSeconds: null,
  environment: null,
  distanceMeters: null,
  intervals: [],
  stations: [],
  sets: [],
  ...seed,
  id: `e2e-${project}-w${seed.week}-${seed.sessionId}`,
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
export async function serveHistory(
  page: Page,
  logs: SeedLog[],
  /** Where to put the Pain reports the page sends, for tests that check them. */
  painReports: Record<string, unknown>[] = [],
  { suggestionDecisions = [], recoveryNights = [] }: SeedExtras = {},
): Promise<Record<string, unknown>[]> {
  const sent: Record<string, unknown>[] = []
  const history = logs.map((l) => toLog(l, 'served'))
  await page.route(/\/api\/(state|sync)$/, (route) => {
    if (route.request().method() === 'POST') {
      const body = route.request().postDataJSON()
      sent.push(...(body.sessionLogs ?? []))
      painReports.push(...(body.painReports ?? []))
    }
    return route.fulfill({
      json: { sessionLogs: [...history, ...sent], suggestionDecisions, painReports, recoveryNights },
    })
  })
  return sent
}

/** Every Session of a Week but the Optional one, Done on `date`: nothing carried, nothing Skipped. */
export const weekDone = (week: number, sessionIds: string[], date: string): SeedLog[] =>
  sessionIds.map((sessionId) => ({ week, sessionId, date, status: 'done' }))
