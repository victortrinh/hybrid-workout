/**
 * Mock mode (ADR-0005): started before the app renders, in a build with
 * `VITE_API=mock` only. Mock Service Worker hands every `/api/*` request to
 * the Worker's Hono app running here, on sql.js, filled with a scenario
 * (src/mock/scenarios) and with the clock pinned to its day. The database
 * lives in this tab's session storage, so a reload keeps it and closing the
 * tab ends it. `?scenario=<name>` switches scenario: everything the app kept
 * goes, and the scenario loads fresh.
 * Returns, with the scenarios, the mock panel's controls: the network
 * between the app and the Worker, and the Shortcut sends.
 */
import { http } from 'msw'
import { setupWorker } from 'msw/browser'
import initSqlJs from 'sql.js'
import wasmUrl from 'sql.js/dist/sql-wasm-browser.wasm?url'
import { localDateIn } from '../domain/calendar'
import { nowDate, nowMs, pinClock } from '../domain/clock'
import { mockApi } from './api'
import type { MockControls } from './controls'
import { d1 } from './d1'
import { openDatabase } from './database'
import { network, NETWORK_KEY, throughNetwork } from './network'
import { chooseScenario, type Current } from './scenarios/choose'
import { findScenario, SCENARIOS } from './scenarios/index'
import { deviceStorage, loadScenario } from './scenarios/load'
import { DEFAULT_NIGHT, DEFAULT_WORKOUT, sendNight, sendWorkout } from './shortcut'

const STORAGE_KEY = 'compromised:mock-db'
const SCENARIO_KEY = 'compromised:mock-scenario'
/** The app's own IndexedDB (src/app/sync/store.ts). */
const APP_DB = 'compromised'
/** Every key the app keeps in local storage starts with this. */
const APP_PREFIX = 'compromised:'

/** What the app shows of mock mode: the badge, the scenario picker and the mock panel (src/app/mockInfo.ts). */
export interface MockInfo {
  scenario: string
  /** A `?scenario=` that named no scenario, so the default stood in. */
  unknown: string | null
  scenarios: { name: string; summary: string }[]
  /** The mock panel's. */
  controls: MockControls
}

export async function startMock(): Promise<MockInfo> {
  const url = new URL(location.href)
  const chosen = chooseScenario(url.searchParams.get('scenario'), readCurrent())
  if (url.searchParams.has('scenario')) {
    // Loaded once: a reload carries on from here rather than starting over.
    url.searchParams.delete('scenario')
    history.replaceState(history.state, '', url)
  }
  const scenario = findScenario(chosen.name)!
  pinClock(scenario.today, scenario.time)
  if (chosen.fresh) await wipeDevice()

  const SQL = await initSqlJs({ locateFile: () => wasmUrl })
  let db
  try {
    db = openDatabase(SQL, chosen.fresh ? undefined : restore())
  } catch {
    // A saved database this build can't migrate: start again from empty.
    db = openDatabase(SQL)
  }
  const save = () => {
    try {
      sessionStorage.setItem(STORAGE_KEY, toBase64(db.export()))
    } catch {
      // Storage full or blocked: the data lasts until the next reload instead.
    }
  }
  const api = mockApi(d1(db, save))
  if (chosen.fresh) {
    await loadScenario(api, scenario)
    for (const [key, value] of Object.entries(deviceStorage(scenario, nowMs()))) attempt(() => localStorage.setItem(key, value))
    const current: Current = { name: chosen.name, unknown: chosen.unknown }
    attempt(() => sessionStorage.setItem(SCENARIO_KEY, JSON.stringify(current)))
  }
  save()
  const net = network()
  // MSW's request is the browser's own; the Worker's types call theirs `Request` too, with Cloudflare's extras.
  await setupWorker(
    http.all('/api/*', ({ request }) => throughNetwork(net.mode(), request as unknown as Request, api)),
  ).start({ quiet: true, onUnhandledFrame: 'bypass' })

  const today = () => localDateIn(nowDate())
  return {
    scenario: chosen.name,
    unknown: chosen.unknown,
    scenarios: SCENARIOS.map(({ name, summary }) => ({ name, summary })),
    controls: {
      network: net.mode,
      setNetwork(mode) {
        net.set(mode)
        // What the phone says when the signal comes and goes: back online, the outbox syncs.
        window.dispatchEvent(new Event(mode === 'offline' ? 'offline' : 'online'))
      },
      subscribe: net.subscribe,
      today,
      defaults: { night: DEFAULT_NIGHT, workout: DEFAULT_WORKOUT },
      sendNight: async (fields) => refreshed(await sendNight(api, today(), fields)),
      sendWorkout: async (fields) => refreshed(await sendWorkout(api, today(), fields)),
    },
  }
}

/**
 * The app reads Recovery data and workouts again whenever it comes back to
 * the front, as it does after the real Shortcut ran. So it does here.
 */
function refreshed<T>(outcome: T): T {
  document.dispatchEvent(new Event('visibilitychange'))
  return outcome
}

/** Opens `scenario` fresh: a new page load, so nothing of the app holds the old one open. */
export function switchScenario(name: string): void {
  const url = new URL(location.href)
  url.searchParams.set('scenario', name)
  location.assign(url)
}

/** Forgets everything the app kept on this device: logs and outbox, settings, Live session, caches. */
async function wipeDevice(): Promise<void> {
  attempt(() => {
    for (const key of Object.keys(localStorage)) if (key.startsWith(APP_PREFIX)) localStorage.removeItem(key)
  })
  attempt(() => {
    sessionStorage.removeItem(STORAGE_KEY)
    sessionStorage.removeItem(SCENARIO_KEY)
    // The network mode holds until the scenario changes.
    sessionStorage.removeItem(NETWORK_KEY)
  })
  await new Promise<void>((resolve) => {
    try {
      const request = indexedDB.deleteDatabase(APP_DB)
      request.onsuccess = request.onerror = request.onblocked = () => resolve()
    } catch {
      resolve()
    }
  })
}

function readCurrent(): Current | null {
  try {
    const saved = JSON.parse(sessionStorage.getItem(SCENARIO_KEY) ?? 'null')
    return typeof saved?.name === 'string' ? { name: saved.name, unknown: saved.unknown ?? null } : null
  } catch {
    return null
  }
}

function attempt(write: () => void) {
  try {
    write()
  } catch {
    // Storage blocked: the scenario still loads, the device state lasts until reload.
  }
}

function restore(): Uint8Array | undefined {
  try {
    const saved = sessionStorage.getItem(STORAGE_KEY)
    return saved ? fromBase64(saved) : undefined
  } catch {
    return undefined
  }
}

function toBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(binary)
}

const fromBase64 = (text: string) => Uint8Array.from(atob(text), (c) => c.charCodeAt(0))

/**
 * Saves an export (`/api/export.json`, `/api/export.zip`). A download link
 * is a navigation, which Mock Service Worker doesn't answer, so the file is
 * fetched (and so answered here) and saved from a blob instead.
 */
export async function saveDownload(href: string): Promise<void> {
  const response = await fetch(href)
  if (!response.ok) throw new Error(`${href} answered ${response.status}`)
  const name = /filename="([^"]+)"/.exec(response.headers.get('content-disposition') ?? '')?.[1] ?? href.split('/').pop()!
  const url = URL.createObjectURL(await response.blob())
  const link = Object.assign(document.createElement('a'), { href: url, download: name })
  document.body.appendChild(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
