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
