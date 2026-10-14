import { useCallback, useEffect, useState } from 'react'
import type { Environment } from '../domain/paces'
import { parseSettings, type Settings, type Theme } from '../domain/settings'

const SETTINGS_KEY = 'compromised:settings'
const OVERRIDES_KEY = 'compromised:environment'

/** Read stored settings, or the defaults when storage is empty, blocked or garbled. */
export function readSettings(): Settings {
  return parseSettings(readJson(SETTINGS_KEY))
}

/** System leaves the choice to the device; light or dark pins it on <html>. */
export function applyTheme(theme: Theme) {
  const root = document.documentElement
  if (theme === 'system') root.removeAttribute('data-theme')
  else root.dataset.theme = theme
}

export interface SettingsState {
  settings: Settings
  change: (patch: Partial<Settings>) => void
  /** Per-Session Environment overrides, keyed by `environmentKey`. */
  overrides: Record<string, Environment>
  override: (week: number, sessionId: string, environment: Environment) => void
}

export const environmentKey = (week: number, sessionId: string) => `${week}/${sessionId}`

/**
 * Settings and per-Session Environment overrides, kept on this device. If
 * storage is blocked they last until reload.
 */
export function useSettings(): SettingsState {
  const [settings, setSettings] = useState(readSettings)
  const [overrides, setOverrides] = useState(readOverrides)

  useEffect(() => applyTheme(settings.theme), [settings.theme])

  const change = useCallback((patch: Partial<Settings>) => {
    setSettings((current) => {
      const next = parseSettings({ ...current, ...patch })
      writeJson(SETTINGS_KEY, next)
      return next
    })
  }, [])

  const override = useCallback((week: number, sessionId: string, environment: Environment) => {
    setOverrides((current) => {
      const next = { ...current, [environmentKey(week, sessionId)]: environment }
      writeJson(OVERRIDES_KEY, next)
      return next
    })
  }, [])

  return { settings, change, overrides, override }
}

function readOverrides(): Record<string, Environment> {
  const value = readJson(OVERRIDES_KEY)
  if (typeof value !== 'object' || value === null) return {}
  return Object.fromEntries(
    Object.entries(value).filter(([, v]) => v === 'indoor' || v === 'outdoor'),
  ) as Record<string, Environment>
}

function readJson(key: string): unknown {
  try {
    const raw = localStorage.getItem(key)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

function writeJson(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // Private mode or storage blocked: the change lasts until reload.
  }
}
