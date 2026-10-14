/**
 * The service worker: keeps the app shell on the phone so the installed app
 * opens in a gym with no signal. Session logs don't pass through here; they
 * live in IndexedDB and sync from the page (src/app/sync).
 *
 * The build (vite.config.ts) replaces PRECACHE with every built file, so a new
 * deploy is a new worker with its own cache.
 */
/// <reference lib="webworker" />

const PRECACHE = /* precache */ []
const VERSION = /* version */ 'dev'
const CACHE = `shell-${VERSION}`
/** How long to wait on the gym's one bar of signal before opening from the cache. */
const NAVIGATION_TIMEOUT_MS = 3000

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting()),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (event) => {
  const request = event.request
  const url = new URL(request.url)
  // The API is never cached: the page knows what to do when it can't be reached.
  if (request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return

  if (request.mode === 'navigate') {
    // Every screen is the same page. Fresh when the network answers in time, else the shell.
    event.respondWith(
      timeout(fetch(request), NAVIGATION_TIMEOUT_MS).catch(() =>
        caches.match('/').then((shell) => shell ?? Response.error()),
      ),
    )
    return
  }

  // Built files carry their hash in the name, so the cached copy is the right one.
  event.respondWith(caches.match(request).then((cached) => cached ?? fetch(request)))
})

function timeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timed out')), ms)
    promise.then(resolve, reject).finally(() => clearTimeout(timer))
  })
}
