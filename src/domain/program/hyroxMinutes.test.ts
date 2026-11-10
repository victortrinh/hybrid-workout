import { describe, expect, it } from 'vitest'
import { DEFAULT_RACE_RUN, defaultStationSeconds, withHyroxMinutes } from './hyroxMinutes'
import { program, stations } from './program'
import type { Session } from './types'

const week = (n: number) => program.phases.flatMap((p) => p.weeks).find((w) => w.number === n)!
const session = (n: number, id: string) => week(n).sessions.find((s) => s.id === id)!
const rounds = (s: Session) => s.blocks.filter((b) => b.main)

describe('HYROX minutes', () => {
  it('add the warm-up, cooldown, every run at Race run pace and every Station, to the nearest 5', () => {
    // Week 11's HYROX A: 4 rounds of a Station and 1 km. At 5:00/km and 60 s a Station:
    // 5 + 4 + 4 × (300 + 60) / 60 = 33 → 35.
    expect(withHyroxMinutes(session(11, 'hyrox-a'), 300, () => 60).minutes).toBe(35)
    // 4 × (300 + 30) / 60 + 9 = 31 → 30.
    expect(withHyroxMinutes(session(11, 'hyrox-a'), 300, () => 30).minutes).toBe(30)
  })

  it('leave Set up out', () => {
    const s = withHyroxMinutes(session(11, 'hyrox-a'), 300, () => 60)
    expect(s.blocks.find((b) => b.setup)?.minutes).toBeUndefined()
  })

  it('give each round its share, so the Blocks never add up past the Session', () => {
    const s = withHyroxMinutes(session(11, 'hyrox-a'), 300, (id) => (id === 'sled-pull' ? 240 : 60))
    const [push, pull] = rounds(s)
    expect(pull.minutes!).toBeGreaterThan(push.minutes!)
    const timed = s.blocks.filter((b) => !b.setup).reduce((sum, b) => sum + b.minutes!, 0)
    expect(timed).toBeLessThanOrEqual(s.minutes)
    expect(timed).toBeGreaterThan(s.minutes - 0.5)
  })

  it('time a Deload’s spare round the same way', () => {
    const s = withHyroxMinutes(session(5, 'hyrox-a'), 300, () => 60)
    expect(s.spareRound?.minutes).toBe(rounds(s)[0].minutes)
  })

  it('go up for a slower Race run pace', () => {
    const minutes = (pace: number) => withHyroxMinutes(session(1, 'hyrox-a'), pace, () => 60).minutes
    expect(minutes(240)).toBeLessThan(minutes(400))
  })

  it('leave every other Session type as it is', () => {
    const run = session(11, 'run')
    expect(withHyroxMinutes(run, 300, () => 60)).toBe(run)
  })

  it('are what the Program is written at: the default Race run pace and Station times', () => {
    const s = session(11, 'hyrox-b')
    expect(withHyroxMinutes(s, DEFAULT_RACE_RUN, (id, v) => defaultStationSeconds(stations[id], v))).toBe(s)
  })
})

describe('the default Station time', () => {
  it('is the race-volume default scaled by share of race volume', () => {
    expect(defaultStationSeconds(stations.skierg, { meters: 1000 })).toBe(270)
    expect(defaultStationSeconds(stations.skierg, { meters: 250 })).toBe(68)
    expect(defaultStationSeconds(stations['wall-balls'], { reps: 50 })).toBe(180)
  })
})
