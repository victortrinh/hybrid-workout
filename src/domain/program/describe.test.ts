import { describe, expect, it } from 'vitest'
import { findWeek } from '../coach'
import { describeSession } from './describe'
import { program } from './program'

const session = (week: number, id: string) => {
  const found = findWeek(program, week)?.sessions.find((s) => s.id === id)
  if (!found) throw new Error(`No Session ${id} in Week ${week}`)
  return describeSession(found)
}

describe('describeSession', () => {
  it('reads intervals as reps, effort and recovery, with no paces before the first 5K test', () => {
    expect(session(1, 'speed')).toEqual({
      heading: 'Speed, 5 × 2′',
      summary: '5 × 2′ hard / 2′ jog',
      target: 'Hard, by feel · 2′ jog · 2 accelerations first',
      meta: '45 min',
    })
    expect(session(3, 'speed').summary).toBe('5 × 3′ hard / 90″ jog')
  })

  it('reads Threshold as effort and RPE and marks the Key session', () => {
    expect(session(1, 'threshold')).toEqual({
      heading: 'Threshold, 3 × 7′',
      summary: '3 × 7′ at Threshold / 2′ jog',
      target: 'Threshold effort, RPE 6–7 · 2′ jog',
      meta: '45 min · Key session this Week',
    })
    expect(session(2, 'threshold').meta).toBe('45 min')
  })

  it('reads Week 1 Strength as calibration and later Weeks as the main lifts', () => {
    expect(session(1, 'strength')).toMatchObject({
      heading: 'Strength, find Working weights',
      target: 'Ramp each lift to RPE 7 to find its Working weight',
    })
    expect(session(2, 'strength')).toMatchObject({
      heading: 'Strength, squat 3 × 5',
      summary: 'Squat 3 × 5, RDL 3 × 6',
      target: 'Squat 3 × 5, RDL 3 × 6 · RPE 7',
    })
  })

  it('reads HYROX as rounds, mentioning Race load only where a load scales', () => {
    expect(session(1, 'hyrox')).toMatchObject({
      heading: 'HYROX, 3 rounds',
      summary: '3 × (600 m + 2 Stations)',
      target: '600 m run + 2 Stations a round · about 60% of Race load',
    })
    expect(session(2, 'hyrox').target).toBe('600 m run + 2 Stations a round')
  })

  it('reads the 5K test and the Optional Easy run', () => {
    expect(session(2, '5k-test')).toEqual({
      heading: '5K test, baseline',
      summary: '5 km all-out',
      target: '5 km all-out · 4 strides first',
      meta: '45 min · Key session this Week',
    })
    expect(session(3, 'easy')).toEqual({
      heading: 'Easy run, 25′',
      summary: '25 min easy',
      target: 'Easy, RPE 2–4',
      meta: '25 min · Optional',
    })
  })
})
