import { describe, expect, it } from 'vitest'
import { findWeek } from '../coach'
import { trainingPaces, type RunContext } from '../paces'
import { describeExercise, describeSession } from './describe'
import { program } from './program'
import type { Session } from './types'

const session = (week: number, id: string) => {
  const found = findWeek(program, week)?.sessions.find((s) => s.id === id)
  if (!found) throw new Error(`No Session ${id} in Week ${week}`)
  return describeSession(found)
}

describe('describeSession', () => {
  it('reads the Run as reps, effort and RPE with no paces yet, and marks the Key session', () => {
    expect(session(1, 'run')).toEqual({
      heading: 'Run, 3 × 7′',
      summary: '3 × 7′ at Threshold / 90″ jog',
      target: 'Threshold effort, RPE 6–7 · 90″ jog',
      meta: '45 min · Key session this Week',
    })
    expect(session(3, 'run').meta).toBe('45 min')
  })

  it('reads Compromised intervals as rounds of 1 km and wall balls', () => {
    expect(session(6, 'run')).toEqual({
      heading: 'Run, 4 × (1 km + 20 wall balls)',
      summary: '4 × (1 km + Wall balls)',
      target: '1 km, then Wall balls, each round · Race load · Race run effort',
      meta: '45 min',
    })
  })

  it('drops the recovery when a cut leaves a single rep', () => {
    const run = findWeek(program, 1)?.sessions.find((s) => s.id === 'run')
    if (!run) throw new Error('No Run in Week 1')
    const oneRep: Session = {
      ...run,
      blocks: run.blocks.map((b) => ({
        ...b,
        exercises: b.exercises.map((e) =>
          e.prescription.kind === 'intervals' ? { ...e, prescription: { ...e.prescription, reps: 1 } } : e,
        ),
      })),
    }
    const described = describeSession(oneRep)
    expect(described.summary).toBe('1 × 7′ at Threshold')
    expect(described.target).toBe('Threshold effort, RPE 6–7')
    const intervals = oneRep.blocks.flatMap((b) => b.exercises).find((e) => e.prescription.kind === 'intervals')
    if (!intervals) throw new Error('No intervals in the Run')
    expect(describeExercise(intervals, program.stations).detail).toBe('1 × 7′ · Threshold effort, RPE 6–7')
  })

  it('reads a Station with its Station target, once the Coach gives it one', () => {
    const ski = { name: 'SkiErg', prescription: { kind: 'station' as const, station: 'skierg' as const, meters: 250 } }
    expect(describeExercise(ski, program.stations).detail).toBe('250 m')
    expect(describeExercise({ ...ski, prescription: { ...ski.prescription, target: 58 } }, program.stations).detail).toBe(
      '250 m · Station target 0:58',
    )
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

  it('reads HYROX A and B as rounds of a Station then a run, at Race load', () => {
    expect(session(1, 'hyrox-a')).toMatchObject({
      heading: 'HYROX A, 8 rounds',
      summary: '8 × (Station + 400 m)',
      target: 'Station, then 400 m, each round · Race load · Race run effort, RPE 7–8',
    })
    expect(session(17, 'hyrox-b')).toMatchObject({ heading: 'HYROX B, 4 rounds', summary: '4 × (Station + 600 m)' })
  })

  it('reads a HYROX run as the exact Race run pace and RPE 7–8 once there are Training paces', () => {
    const hyroxA = program.phases[0].weeks[0].sessions.find((s) => s.id === 'hyrox-a')!
    const run: RunContext = { paces: trainingPaces(315), environment: 'outdoor', unit: 'kmh' }
    expect(describeSession(hyroxA, run).target).toBe('Station, then 400 m, each round · Race load · 5:15/km · RPE 7–8')
  })

  it('adds the HYROX Set up to the minutes as an estimate, outside them', () => {
    expect(session(1, 'hyrox-a').meta).toBe('35 min + ~5′ setup')
    expect(session(3, 'hyrox-a').meta).toBe('35 min + ~5′ setup · Key session this Week')
    expect(session(5, 'hyrox-b').meta).toBe('30 min + ~5′ setup')
    expect(session(16, 'race-simulation').meta).toBe('65 min · Key session this Week')
  })

  it('reads the Compromised run test and the Optional Easy run', () => {
    expect(session(2, 'compromised-run-test')).toEqual({
      heading: 'Compromised run test, baseline',
      summary: '4 × (1 km + Station)',
      target: '1 km, then Station, each round · Race load · all-out',
      meta: '45 min · Key session this Week',
    })
    expect(session(3, 'easy')).toEqual({
      heading: 'Easy run, 30′',
      summary: '30 min easy',
      target: 'Easy, RPE 2–4',
      meta: '30 min · Optional',
    })
  })
})
