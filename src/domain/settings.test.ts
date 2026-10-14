import { describe, expect, it } from 'vitest'
import { localDate } from './calendar'
import { DEFAULT_SETTINGS, environmentOn, parseSettings } from './settings'

describe('settings', () => {
  it('default to km/h, the system theme and the treadmill from November to March', () => {
    expect(DEFAULT_SETTINGS.unit).toBe('kmh')
    expect(DEFAULT_SETTINGS.theme).toBe('system')
    expect(environmentOn(localDate('2026-10-28'), DEFAULT_SETTINGS)).toBe('outdoor')
    expect(environmentOn(localDate('2026-11-02'), DEFAULT_SETTINGS)).toBe('indoor')
    expect(environmentOn(localDate('2027-03-31'), DEFAULT_SETTINGS)).toBe('indoor')
    expect(environmentOn(localDate('2027-04-01'), DEFAULT_SETTINGS)).toBe('outdoor')
  })

  it('let a Session override its month', () => {
    expect(environmentOn(localDate('2026-12-16'), DEFAULT_SETTINGS, 'outdoor')).toBe('outdoor')
    expect(environmentOn(localDate('2026-12-16'), DEFAULT_SETTINGS, null)).toBe('indoor')
  })

  it('fill anything missing or unknown from the defaults', () => {
    expect(parseSettings(null)).toEqual(DEFAULT_SETTINGS)
    expect(parseSettings({ theme: 'sepia', unit: 'knots', environmentByMonth: 'indoor' })).toEqual(DEFAULT_SETTINGS)
    const custom = parseSettings({ theme: 'dark', unit: 'mph', environmentByMonth: ['outdoor', 'pool'] })
    expect(custom.theme).toBe('dark')
    expect(custom.unit).toBe('mph')
    expect(custom.environmentByMonth.slice(0, 3)).toEqual(['outdoor', 'indoor', 'indoor'])
  })

  it('default to the athlete’s gym: floor space, no calf machines', () => {
    expect(DEFAULT_SETTINGS.equipment).toEqual(['floor-space'])
    expect(parseSettings({ equipment: ['seated-calf-machine', 'rower'] }).equipment).toEqual(['seated-calf-machine'])
  })
})
