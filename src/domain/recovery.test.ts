import { describe, expect, it } from 'vitest'
import { localDate } from './calendar'
import { hrvMean, isLowHrv, lastNight, mergeNights, parseRecoveryNight, sleepText, type RecoveryNight } from './recovery'

const AT = '2026-11-04T12:00:00.000Z'
const body = { date: '2026-11-04', sleepMinutes: 341, hrvMs: 38, restingHeartRate: 52, source: 'Ultrahuman' }

describe('parseRecoveryNight', () => {
  it('takes what the Shortcut sends, stamped with when it arrived', () => {
    expect(parseRecoveryNight(body, AT)).toEqual({ ...body, receivedAt: AT })
  })

  it('rounds the decimals Shortcuts sums durations into, and trims the source', () => {
    expect(parseRecoveryNight({ ...body, sleepMinutes: 340.6, hrvMs: 38.4, source: ' Ultrahuman ' }, AT)).toMatchObject({
      sleepMinutes: 341,
      hrvMs: 38,
      source: 'Ultrahuman',
    })
  })

  it('takes a night without HRV or resting heart rate: missing, empty or 0 is no reading', () => {
    for (const missing of [undefined, null, '', 0]) {
      expect(
        parseRecoveryNight({ ...body, sleepMinutes: 400, hrvMs: missing, restingHeartRate: missing }, AT),
      ).toMatchObject({ hrvMs: null, restingHeartRate: null })
    }
  })

  it('takes the day it arrived, in Toronto, when the date is left out or empty', () => {
    // 03:30 UTC is still the evening before in Toronto.
    for (const date of [undefined, null, '', '  ']) {
      expect(parseRecoveryNight({ ...body, date }, '2026-11-04T12:00:00.000Z').date).toBe('2026-11-04')
      expect(parseRecoveryNight({ ...body, date }, '2026-11-05T03:30:00.000Z').date).toBe('2026-11-04')
    }
  })

  it('takes a full timestamp as its day in Toronto', () => {
    expect(parseRecoveryNight({ ...body, date: '2026-11-04T09:31:00-05:00' }, AT).date).toBe('2026-11-04')
    expect(parseRecoveryNight({ ...body, date: '2026-11-05T02:00:00Z' }, AT).date).toBe('2026-11-04')
  })

  it('takes numbers sent as text', () => {
    expect(parseRecoveryNight({ ...body, sleepMinutes: '341.2', hrvMs: ' 38 ' }, AT)).toMatchObject({ sleepMinutes: 341, hrvMs: 38 })
  })

  it('refuses a night with no sleep, rather than read it as 0 hours', () => {
    for (const none of [0, '', null, undefined]) {
      expect(() => parseRecoveryNight({ ...body, sleepMinutes: none }, AT)).toThrow(/No sleep in Apple Health/)
    }
  })

  it.each([
    ['no body', null],
    ['a date as words', { ...body, date: 'Oct 14, 2026' }],
    ['a date that isn’t one', { ...body, date: '2026-02-30' }],
    ['a US date', { ...body, date: '11/04/2026' }],
    ['sleep as words', { ...body, sleepMinutes: 'lots' }],
    ['more than a day of sleep', { ...body, sleepMinutes: 1500 }],
    ['negative sleep', { ...body, sleepMinutes: -1 }],
    ['HRV of 1000', { ...body, hrvMs: 1000 }],
    ['an absurd heart rate', { ...body, restingHeartRate: 400 }],
    ['no source', { ...body, source: undefined }],
    ['a source too long', { ...body, source: 'x'.repeat(65) }],
  ])('refuses %s', (_, value) => {
    expect(() => parseRecoveryNight(value, AT)).toThrow()
  })
})

const night = (iso: string, hrvMs: number | null, receivedAt = `${iso}T12:00:00.000Z`): RecoveryNight => ({
  date: localDate(iso),
  sleepMinutes: 420,
  hrvMs,
  restingHeartRate: 50,
  source: 'Ultrahuman',
  receivedAt,
})

describe('hrvMean', () => {
  const today = localDate('2026-11-08')

  it('averages the 7 nights before the morning, not the morning itself', () => {
    const nights = [night('2026-10-31', 100), night('2026-11-01', 50), night('2026-11-05', 52), night('2026-11-07', 54), night('2026-11-08', 10)]
    expect(hrvMean(nights, today)).toBe(52)
  })

  it('needs 3 nights with HRV', () => {
    expect(hrvMean([night('2026-11-06', 50), night('2026-11-07', 54), night('2026-11-05', null)], today)).toBeNull()
  })
})

describe('isLowHrv', () => {
  it('is 15% or more under the mean', () => {
    expect(isLowHrv(85, 100)).toBe(true)
    expect(isLowHrv(86, 100)).toBe(false)
    expect(isLowHrv(null, 100)).toBe(false)
    expect(isLowHrv(10, null)).toBe(false)
  })
})

describe('mergeNights', () => {
  it('keeps one night per morning, the later arrival, in date order', () => {
    const first = night('2026-11-04', 40, '2026-11-04T11:00:00.000Z')
    const resend = night('2026-11-04', 38, '2026-11-04T12:00:00.000Z')
    const before = night('2026-11-03', 50)
    expect(mergeNights([resend], [first, before])).toEqual([before, resend])
    expect(mergeNights([first], [resend])).toEqual([resend])
  })
})

describe('sleepText', () => {
  it('reads hours and minutes', () => {
    expect([341, 420, 365].map(sleepText)).toEqual(['5 h 41', '7 h 00', '6 h 05'])
  })
})

describe('lastNight', () => {
  const NOW = '2026-10-14T15:00:00.000Z' // 11:00 in Toronto
  const at = (time: string) => `2026-10-14T${time}-04:00`
  const yesterday = (time: string) => `2026-10-13T${time}-04:00`
  const lines = (pairs: [string, string][]) => pairs.map(([a, b]) => `${a} ${b}`).join('\n')

  it('adds up a night of stages', () => {
    // 23:30 to 07:30 with a 20-minute wake (left out by the Value filter) at 03:00.
    const night = lines([
      [yesterday('23:30:00'), at('03:00:00')],
      [at('03:20:00'), at('07:30:00')],
    ])
    expect(lastNight(night, NOW)).toBe(460)
  })

  it('counts each minute once when the Watch and the ring both tracked the night', () => {
    const watch: [string, string][] = [
      [yesterday('23:30:00'), at('02:00:00')],
      [at('02:00:00'), at('07:30:00')],
    ]
    const ring: [string, string][] = [
      [yesterday('23:40:00'), at('04:00:00')],
      [at('04:00:00'), at('07:20:00')],
    ]
    expect(lastNight(lines([...watch, ...ring]), NOW)).toBe(480)
  })

  it('leaves out the night before, more than 3 hours earlier', () => {
    const night = lines([
      [yesterday('00:40:00'), yesterday('07:00:00')],
      [yesterday('23:30:00'), at('07:30:00')],
    ])
    expect(lastNight(night, NOW)).toBe(480)
  })

  it('reads entries in any order, with commas or tabs', () => {
    expect(lastNight(`${at('03:00:00')}\t${at('07:30:00')}\n${yesterday('23:30:00')},${at('03:00:00')}`, NOW)).toBe(480)
  })

  it('is null with no entries, and refuses lines that aren’t two timestamps', () => {
    expect(lastNight('   ', NOW)).toBeNull()
    expect(() => lastNight('Health sample', NOW)).toThrow(/start end/)
    expect(() => lastNight(`${at('07:30:00')} ${at('03:00:00')}`, NOW)).toThrow(/start end/)
  })

  it('feeds parseRecoveryNight in place of sleepMinutes', () => {
    const sleep = lines([[yesterday('23:30:00'), at('07:30:00')]])
    expect(parseRecoveryNight({ sleep, hrvMs: 52, source: 'Ultrahuman' }, NOW)).toMatchObject({
      date: '2026-10-14',
      sleepMinutes: 480,
    })
    expect(() => parseRecoveryNight({ sleep: '', source: 'Ultrahuman' }, NOW)).toThrow(/No sleep/)
  })
})
