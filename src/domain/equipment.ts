/**
 * The Equipment profile: what the athlete's gym has. Whatever it lacks, the
 * Exercises that need it give way to their Substitutions, before anything
 * reads the Session: Today, the Week, a Live session.
 */
import type { Exercise, Session, SubstitutionReason, Week } from './program/types'

export const EQUIPMENT = ['calf-machine', 'seated-calf-machine', 'floor-space'] as const
export type Equipment = (typeof EQUIPMENT)[number]

export const EQUIPMENT_LABEL: Record<Equipment, string> = {
  'calf-machine': 'Standing calf machine',
  'seated-calf-machine': 'Seated calf machine',
  'floor-space': 'Floor space for jumps',
}

/** The athlete's gym: room to jump, no calf machines (training-plan.md, "Resolved during approval"). */
export const DEFAULT_EQUIPMENT: readonly Equipment[] = ['floor-space']

/** The Substitution reason each missing piece of equipment raises. */
const MISSING: Record<Equipment, SubstitutionReason> = {
  'calf-machine': 'no-calf-machine',
  'seated-calf-machine': 'no-seated-calf-machine',
  'floor-space': 'no-floor-space',
}

/** Whatever was stored, as a clean profile: unknown items dropped, each kept once, in a fixed order. */
export function parseEquipment(value: unknown): Equipment[] {
  if (!Array.isArray(value)) return [...DEFAULT_EQUIPMENT]
  return EQUIPMENT.filter((e) => value.includes(e))
}

/**
 * The Session as it is done in this gym: each Exercise whose Substitution
 * applies replaced by the Substitution's first option. Returns the same
 * Session when nothing changes.
 */
export function equip(session: Session, equipment: readonly Equipment[]): Session {
  const missing = new Set(EQUIPMENT.filter((e) => !equipment.includes(e)).map((e) => MISSING[e]))
  if (missing.size === 0) return session
  let changed = false
  const blocks = session.blocks.map((block) => {
    const exercises = block.exercises.map((exercise) => {
      const swap = substituteFor(exercise, missing)
      if (swap !== exercise) changed = true
      return swap
    })
    return { ...block, exercises }
  })
  return changed ? { ...session, blocks } : session
}

export function equipWeek(week: Week, equipment: readonly Equipment[]): Week {
  return { ...week, sessions: week.sessions.map((s) => equip(s, equipment)) }
}

function substituteFor(exercise: Exercise, missing: Set<SubstitutionReason>): Exercise {
  const substitution = exercise.substitutions?.find((s) => s.when.some((reason) => missing.has(reason)))
  return substitution?.options[0] ?? exercise
}
