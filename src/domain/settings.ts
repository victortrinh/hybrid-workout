/**
 * The athlete's settings: treadmill units, where runs happen each month, and
 * the theme. They live on the device; nothing in them changes the Program.
 */
import type { LocalDate } from './calendar'
import { ENVIRONMENTS, SPEED_UNITS, type Environment, type SpeedUnit } from './paces'

export const THEMES = ['system', 'light', 'dark'] as const
export type Theme = (typeof THEMES)[number]

export interface Settings {
  theme: Theme
  unit: SpeedUnit
  /** January first: where runs happen unless a Session says otherwise. */
  environmentByMonth: Environment[]
}

const indoor = 'indoor' as const
const outdoor = 'outdoor' as const

/** Toronto: the treadmill from November to March, outside the rest of the year. */
export const DEFAULT_SETTINGS: Settings = {
  theme: 'system',
  unit: 'kmh',
  environmentByMonth: [indoor, indoor, indoor, outdoor, outdoor, outdoor, outdoor, outdoor, outdoor, outdoor, indoor, indoor],
}

export const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const

/** Whatever was stored, made whole: anything missing or unknown falls back to the default. */
export function parseSettings(value: unknown): Settings {
  const v = (typeof value === 'object' && value !== null ? value : {}) as Record<string, unknown>
  const byMonth = Array.isArray(v.environmentByMonth) ? v.environmentByMonth : []
  return {
    theme: THEMES.includes(v.theme as Theme) ? (v.theme as Theme) : DEFAULT_SETTINGS.theme,
    unit: SPEED_UNITS.includes(v.unit as SpeedUnit) ? (v.unit as SpeedUnit) : DEFAULT_SETTINGS.unit,
    environmentByMonth: DEFAULT_SETTINGS.environmentByMonth.map((fallback, i) =>
      ENVIRONMENTS.includes(byMonth[i]) ? (byMonth[i] as Environment) : fallback,
    ),
  }
}

/** Where a run on `date` happens: the Session's own override, or the month's default. */
export function environmentOn(date: LocalDate, settings: Settings, override?: Environment | null): Environment {
  return override ?? settings.environmentByMonth[Number(date.slice(5, 7)) - 1]
}
