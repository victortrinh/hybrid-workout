/**
 * Puts a scenario in place: its server data through the Worker's own routes,
 * as the app and the Shortcuts would send it, so a scenario a migration or a
 * parser no longer accepts fails loudly; and its device state as the app's
 * own storage keys hold it.
 */
import { parseSettings } from '../../domain/settings'
import { MOCK_SERVICE_TOKEN } from '../api'
import type { Scenario } from './scenario'

/** Well under the Worker's 500 a sync takes. */
const BATCH = 200

export async function loadScenario(api: (request: Request) => Promise<Response>, scenario: Scenario): Promise<void> {
  const send = async (path: string, body: unknown, headers: Record<string, string> = {}) => {
    const response = await api(
      new Request(`http://localhost/api/${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify(body),
      }),
    )
    if (!response.ok) throw new Error(`Scenario ${scenario.name}: /api/${path} answered ${response.status}, ${await response.text()}`)
  }
  const { sessionLogs, suggestionDecisions, painReports, activityAnswers, startingPoint, recoveryNights, activities } =
    scenario.server
  for (let i = 0; i < sessionLogs.length; i += BATCH) await send('sync', { sessionLogs: sessionLogs.slice(i, i + BATCH) })
  await send('sync', { suggestionDecisions, painReports, activityAnswers, startingPoint })

  const token = { 'CF-Access-Client-Id': MOCK_SERVICE_TOKEN.id, 'CF-Access-Client-Secret': MOCK_SERVICE_TOKEN.secret }
  for (const night of recoveryNights) await send('recovery', night, token)
  for (const activity of activities) await send('activities', activity, token)
}

/** The device's storage for the scenario, by key (src/app/useSettings.ts, src/app/useLiveRun.ts). */
export function deviceStorage(scenario: Scenario, now: number): Record<string, string> {
  const { settings, environment, live } = scenario.device
  return {
    'compromised:settings': JSON.stringify(parseSettings(settings)),
    ...(Object.keys(environment).length > 0 && { 'compromised:environment': JSON.stringify(environment) }),
    ...(live && { 'compromised:live': JSON.stringify(live(now)) }),
  }
}
