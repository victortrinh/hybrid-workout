import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { MockBadge } from './components/MockBadge'
import './styles.css'
import { applyTheme, readSettings } from './useSettings'

const mock = import.meta.env.VITE_API === 'mock'

// Before the first render, so a pinned theme never flashes the other one.
applyTheme(readSettings().theme)

// Mock mode answers /api/* in the browser (ADR-0005), so it's listening before the app's first request.
if (mock) await (await import('virtual:compromised-mock')).startMock()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
    {mock && <MockBadge />}
  </StrictMode>,
)

// The app shell on the phone, so the installed app opens without signal (src/sw/sw.js).
// Builds only: in dev it would serve stale modules over HMR. Not in mock builds,
// whose one service worker is Mock Service Worker's.
if (import.meta.env.PROD && !mock && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      // No offline shell this time; the app works online all the same.
    })
  })
}
