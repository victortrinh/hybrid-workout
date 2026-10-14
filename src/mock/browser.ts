/**
 * Mock mode (ADR-0005): started before the app renders, in a build with
 * `VITE_API=mock` only. Mock Service Worker hands every `/api/*` request to
 * the Worker's Hono app running here, on sql.js. The database lives in this
 * tab's session storage, so a reload keeps it and closing the tab ends it.
 * Returns the mock panel's controls: the network between the app and the
 * Worker, and the Shortcut sends.
 */
import { http } from 'msw'
import { setupWorker } from 'msw/browser'
import initSqlJs from 'sql.js'
import wasmUrl from 'sql.js/dist/sql-wasm-browser.wasm?url'
import { localDateIn } from '../domain/calendar'
import { nowDate } from '../domain/clock'
import { mockApi } from './api'
import type { MockControls } from './controls'
import { d1 } from './d1'
import { openDatabase } from './database'
import { network, throughNetwork } from './network'
import { DEFAULT_NIGHT, DEFAULT_WORKOUT, sendNight, sendWorkout } from './shortcut'

const STORAGE_KEY = 'compromised:mock-db'

export async function startMock(): Promise<MockControls> {
  const SQL = await initSqlJs({ locateFile: () => wasmUrl })
  let db
  try {
    db = openDatabase(SQL, restore())
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
  save()
  const api = mockApi(d1(db, save))
  const net = network()
  // MSW's request is the browser's own; the Worker's types call theirs `Request` too, with Cloudflare's extras.
  await setupWorker(
    http.all('/api/*', ({ request }) => throughNetwork(net.mode(), request as unknown as Request, api)),
  ).start({ quiet: true, onUnhandledFrame: 'bypass' })

  const today = () => localDateIn(nowDate())
  return {
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
