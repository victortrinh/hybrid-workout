/**
 * The mock panel's Shortcut sends: what the Recovery and Workout Shortcuts
 * post, with the mock service token, to the real `/api/recovery` and
 * `/api/activities` routes. They go to the Worker directly, not through the
 * network control: the Shortcut runs on the phone, not in the app, so a
 * night can reach the server while the app is Offline.
 */
import { addDays, type LocalDate } from '../domain/calendar'
import { instantAt } from '../domain/clock'
import type { RecoveryNight } from '../domain/recovery'
import { MOCK_SERVICE_TOKEN } from './api'
import type { NightFields, SendOutcome, WorkoutFields } from './controls'

type Api = (request: Request) => Promise<Response>

/** Under 6 hours, with HRV well under the baseline below: the short-sleep change, and the easy-day Suggestion. */
export const DEFAULT_NIGHT: NightFields = { sleepMinutes: 320, hrvMs: 38, restingHeartRate: 56, baseline: true }

/** A morning run, which fits every run of the Week: with two still planned, Today asks which it was. */
export const DEFAULT_WORKOUT: WorkoutFields = {
  type: 'Running',
  start: '07:00',
  minutes: 45,
  distanceKm: 8,
  averageHeartRate: 150,
}

/** A normal night of the baseline week, HRV around 52. */
const BASELINE_HRV = [50, 54, 52, 51, 53, 52, 52]
const SOURCE = 'Mock ring'
const WATCH = 'Mock Apple Watch'

export async function sendNight(api: Api, today: LocalDate, fields: NightFields): Promise<SendOutcome> {
  const { baseline, ...numbers } = fields
  let filled = 0
  if (baseline) {
    const state = (await (await api(new Request('http://mock/api/state'))).json()) as { recoveryNights?: RecoveryNight[] }
    const had = new Set((state.recoveryNights ?? []).map((n) => n.date))
    for (let i = 7; i >= 1; i--) {
      const date = addDays(today, -i)
      if (had.has(date)) continue
      const night = { date, sleepMinutes: 450, hrvMs: BASELINE_HRV[7 - i], restingHeartRate: 48, source: SOURCE }
      const response = await post(api, '/api/recovery', night)
      if (!response.ok) return refused('night', response)
      filled++
    }
  }
  const response = await post(api, '/api/recovery', { date: today, ...numbers, source: SOURCE })
  if (!response.ok) return refused('night', response)
  const asleep = `${Math.floor(fields.sleepMinutes / 60)} h ${String(fields.sleepMinutes % 60).padStart(2, '0')}`
  const before = filled > 0 ? `, and ${filled} normal night${filled === 1 ? '' : 's'} before it` : ''
  return { ok: true, message: `Sent ${asleep} asleep for ${today}${before}.` }
}

export async function sendWorkout(api: Api, today: LocalDate, fields: WorkoutFields): Promise<SendOutcome> {
  const start = instantAt(today, fields.start)
  const end = start + fields.minutes * 60_000
  const at = (fraction: number) => new Date(start + (end - start) * fraction).toISOString()
  const hr = fields.averageHeartRate
  const km = fields.distanceKm
  const workout = {
    type: fields.type,
    start: new Date(start).toISOString(),
    end: new Date(end).toISOString(),
    // As Health has them: one sample per line, with its time, and the device that measured it.
    heartRates: [`${hr - 5} ${at(0.2)}`, `${hr} ${at(0.5)}`, `${hr + 5} ${at(0.8)}`].join('\n'),
    ...(km
      ? { distanceSamples: [`${(km / 2).toFixed(2)} km ${at(0.5)} ${WATCH}`, `${(km / 2).toFixed(2)} km ${at(1)} ${WATCH}`].join('\n') }
      : {}),
  }
  const response = await post(api, '/api/activities', workout)
  if (!response.ok) return refused('workout', response)
  return { ok: true, message: `Sent ${fields.type}, ${fields.minutes} min from ${fields.start} on ${today}.` }
}

function post(api: Api, path: string, body: unknown): Promise<Response> {
  return api(
    new Request(`http://mock${path}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'CF-Access-Client-Id': MOCK_SERVICE_TOKEN.id,
        'CF-Access-Client-Secret': MOCK_SERVICE_TOKEN.secret,
      },
      body: JSON.stringify(body),
    }),
  )
}

async function refused(what: string, response: Response): Promise<SendOutcome> {
  const { error } = (await response.json().catch(() => ({}))) as { error?: string }
  return { ok: false, message: `The ${what} was refused (${response.status}): ${error ?? 'no reason given'}` }
}
