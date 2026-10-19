import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { localDate, localDateIn } from './calendar'
import { nowDate, nowMs, pinClock, unpinClock } from './clock'

const REAL = Date.parse('2026-10-21T16:00:00.000Z')

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(REAL)
})

afterEach(() => {
  unpinClock()
  vi.useRealTimers()
})

describe('the real clock', () => {
  it('reads Date, so Playwright and fake timers can move it', () => {
    expect(nowMs()).toBe(REAL)
    expect(nowDate().toISOString()).toBe('2026-10-21T16:00:00.000Z')
    vi.advanceTimersByTime(90_000)
    expect(nowMs()).toBe(REAL + 90_000)
  })
})

describe('a pinned clock', () => {
  it('starts at the local time in America/Toronto', () => {
    pinClock(localDate('2027-01-11'), '06:30')
    expect(nowDate().toISOString()).toBe('2027-01-11T11:30:00.000Z')
  })

  it('knows daylight saving time', () => {
    pinClock(localDate('2027-04-21'), '09:00')
    expect(nowDate().toISOString()).toBe('2027-04-21T13:00:00.000Z')
  })

  it('starts at midnight unless given a time', () => {
    pinClock(localDate('2027-01-11'))
    expect(nowDate().toISOString()).toBe('2027-01-11T05:00:00.000Z')
  })

  it('ticks forward at real speed, so timers still run', () => {
    pinClock(localDate('2027-01-11'), '06:30')
    const start = nowMs()
    vi.advanceTimersByTime(45_000)
    expect(nowMs() - start).toBe(45_000)
  })

  it('crosses midnight into the next local date', () => {
    pinClock(localDate('2027-01-11'), '23:59')
    expect(localDateIn(nowDate())).toBe('2027-01-11')
    vi.advanceTimersByTime(60_000)
    expect(localDateIn(nowDate())).toBe('2027-01-12')
  })

  it('goes back to real time when unpinned', () => {
    pinClock(localDate('2027-01-11'), '06:30')
    unpinClock()
    expect(nowMs()).toBe(REAL)
  })

  it('refuses a time that is not HH:MM', () => {
    expect(() => pinClock(localDate('2027-01-11'), '6:30')).toThrow('Not a time')
  })
})
