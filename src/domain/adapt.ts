/**
 * Adapted Prescriptions: the Program's Sessions after accepted Suggestions.
 *
 * Adaptation never edits the Program. It is recomputed from the decisions
 * every time, so Undo is just a decision going back to Open.
 */
import type { Exercise, Prescription, Session, Week } from './program/types'

/** A lighter re-entry Week keeps about two thirds of the volume, like a Deload week. */
export const RE_ENTRY_PERCENT = 67

/**
 * Cuts a Session's volume to `percent`: fewer reps and sets, shorter runs,
 * less Station work, fewer minutes. Intensity stays as written. A 5K test
 * and anything pinned to a day (the race) stay whole: a shorter test isn't
 * a test.
 */
export function lighten(session: Session, percent: number): Session {
  if (session.type === '5k-test' || session.date) return session
  const scale = percent / 100
  const mainReps = session.blocks
    .filter((b) => b.main)
    .flatMap((b) => b.exercises)
    .map((e) => e.prescription)
    .find((rx) => rx.kind === 'intervals')?.reps

  return {
    ...session,
    headline:
      mainReps === undefined
        ? session.headline
        : session.headline.replace(/^\d+(?= × )/, String(count(mainReps, scale))),
    minutes: Math.round(session.minutes * scale),
    blocks: session.blocks.map((block) => ({
      ...block,
      minutes: block.minutes === undefined ? undefined : Math.round(block.minutes * scale),
      exercises: block.exercises.map((exercise) => lightenExercise(exercise, scale)),
    })),
  }
}

export function lightenWeek(week: Week, percent: number): Week {
  return { ...week, sessions: week.sessions.map((s) => lighten(s, percent)) }
}

function lightenExercise(exercise: Exercise, scale: number): Exercise {
  return { ...exercise, prescription: lightenPrescription(exercise.prescription, scale) }
}

function lightenPrescription(rx: Prescription, scale: number): Prescription {
  switch (rx.kind) {
    case 'run':
      return {
        ...rx,
        minutes: rx.minutes === undefined ? undefined : Math.round(rx.minutes * scale),
        meters: rx.meters === undefined ? undefined : step(rx.meters * scale, 100),
      }
    case 'intervals':
    case 'strides':
    case 'accelerations':
      return { ...rx, reps: count(rx.reps, scale) }
    case 'sets':
    case 'drill':
      return { ...rx, sets: count(rx.sets, scale) }
    case 'station':
      return {
        ...rx,
        meters: rx.meters === undefined ? undefined : step(rx.meters * scale, 5),
        reps: rx.reps === undefined ? undefined : step(rx.reps * scale, 5),
      }
    case 'note':
      return { ...rx, minutes: rx.minutes === undefined ? undefined : Math.round(rx.minutes * scale) }
    case 'sprints':
      return rx
  }
}

/** Reps and sets: rounded, never below one. */
const count = (n: number, scale: number) => Math.max(1, Math.round(n * scale))

/** Distances and Station reps: to the nearest `size`, never below it. */
const step = (value: number, size: number) => Math.max(size, Math.round(value / size) * size)
