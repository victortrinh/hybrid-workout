import { describe, expect, it } from 'vitest'
import { localDate } from './calendar'
import { coach, findWeek } from './coach'
import { DEFAULT_EQUIPMENT, equip, parseEquipment } from './equipment'
import { program } from './program/program'
import type { Session } from './program/types'

const session = (week: number, id: string): Session => findWeek(program, week)!.sessions.find((s) => s.id === id)!
const names = (s: Session) => s.blocks.flatMap((b) => b.exercises).map((e) => e.name)

describe('Substitutions from the Equipment profile', () => {
  it('swaps the calf machines for the dumbbell single-leg and loaded seated raises in the athlete’s gym', () => {
    const strength = equip(session(3, 'strength'), DEFAULT_EQUIPMENT)
    const tendon = strength.blocks.find((b) => b.name === 'Tendon')!.exercises
    expect(tendon.map((e) => [e.name, e.note])).toEqual([
      ['Single-leg calf raise', 'Off a step, dumbbell in hand, 2–3 s lowering'],
      ['Loaded seated calf raise', 'Dumbbell or barbell on the knees'],
    ])
    expect(tendon.map((e) => e.prescription.kind === 'sets' && e.prescription.load)).toEqual([
      { kind: 'working-weight', lift: 'single-leg-calf-raise' },
      { kind: 'working-weight', lift: 'seated-calf-raise' },
    ])
  })

  it('keeps the machines where the gym has them, each on its own Working weight', () => {
    const strength = equip(session(3, 'strength'), ['calf-machine', 'seated-calf-machine', 'floor-space'])
    const tendon = strength.blocks.find((b) => b.name === 'Tendon')!.exercises
    expect(tendon.map((e) => e.prescription.kind === 'sets' && 'lift' in e.prescription.load && e.prescription.load.lift)).toEqual([
      'standing-calf-raise-machine',
      'seated-calf-raise-machine',
    ])
  })

  it('swaps one machine and not the other', () => {
    expect(names(equip(session(3, 'strength'), ['seated-calf-machine', 'floor-space']))).toContain('Single-leg calf raise')
    expect(names(equip(session(3, 'strength'), ['seated-calf-machine', 'floor-space']))).toContain('Seated calf raise')
  })

  it('keeps the Deload and Taper loads on the Substitution', () => {
    const deload = equip(session(7, 'strength'), DEFAULT_EQUIPMENT)
    const calf = deload.blocks.flatMap((b) => b.exercises).find((e) => e.name === 'Single-leg calf raise')!
    expect(calf.prescription).toMatchObject({ sets: 2, load: { kind: 'percent-of-working-weight', percent: [85, 90] } })
    const taper = equip(session(25, 'strength'), DEFAULT_EQUIPMENT)
    expect(names(taper)).toEqual(['Bike and movement prep', 'Back squat', 'Romanian deadlift', 'Single-leg calf raise'])
  })

  it('takes jumps and accelerations off the floor without floor space', () => {
    expect(names(session(3, 'speed'))).toContain('Accelerations')
    const noFloor = equip(session(3, 'speed'), [])
    expect(names(noFloor)).not.toContain('Accelerations')
    expect(names(noFloor)).toContain('Sled push sprints')
  })

  it('leaves a Session with nothing to swap as it is', () => {
    const threshold = session(3, 'threshold')
    expect(equip(threshold, [])).toBe(threshold)
  })

  it('applies to everything the Coach hands out', () => {
    const day = coach({ program, today: localDate('2026-11-11'), equipment: ['calf-machine', 'floor-space'] })
    const strength = day.bucket.find((e) => e.session.id === 'strength')!.session
    expect(names(strength)).toContain('Standing calf raise')
    expect(names(strength)).toContain('Loaded seated calf raise')
  })

  it('reads a stored profile, dropping anything unknown', () => {
    expect(parseEquipment(['floor-space', 'treadmill', 'calf-machine', 'floor-space'])).toEqual(['calf-machine', 'floor-space'])
    expect(parseEquipment(undefined)).toEqual(['floor-space'])
    expect(parseEquipment([])).toEqual([])
  })
})
