import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import './styles.css'
import { applyTheme, readSettings } from './useSettings'

// Before the first render, so a pinned theme never flashes the other one.
applyTheme(readSettings().theme)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

// The app shell on the phone, so the installed app opens without signal (src/sw/sw.js).
// Builds only: in dev it would serve stale modules over HMR.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      // No offline shell this time; the app works online all the same.
    })
  })
}
