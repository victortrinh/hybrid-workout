/**
 * Pain reports and the pain rules (docs/training-plan.md, Rules, 2):
 * pain 3 or more, or rising, means no jumps or accelerations (bike instead)
 * and about 30% fewer interval reps; pain 5 or more makes the Session easy
 * low-impact work or rest.
 *
 * A report stands until the next one, so the "No" before a Session matters
 * too: it is a report of 0, and it ends whatever pain stood before it.
 */
import { localDate, type LocalDate } from './calendar'
import type { Block, Exercise, Session } from './program/types'

export const PAIN_AREAS = ['achilles-calf', 'shin', 'knee', 'hip', 'back', 'other'] as const
export type PainArea = (typeof PAIN_AREAS)[number]

export const PAIN_AREA_LABEL: Record<PainArea, string> = {
  'achilles-calf': 'Achilles / calf',
  shin: 'Shin',
  knee: 'Knee',
  hip: 'Hip',
  back: 'Back',
  other: 'Other',
}

export interface PainReport {
  /** Made on the device; lowercase, so the Suggestion it triggers can carry it. */
  id: string
  /** The day it was reported, in America/Toronto. */
  date: LocalDate
  /** 0 for "No", otherwise 1–10. */
  score: number
  /** Where it hurts; null with a score of 0. */
  area: PainArea | null
  /** The Session it was given for, at Start or in Log after; null from "Something hurts". */
  week: number | null
  sessionId: string | null
  /** ISO instant it was reported: orders reports given the same day. */
  updatedAt: string
}

/** Pain at which jumps and accelerations go to the bike and interval reps drop. */
export const PAIN_EASE = 3
/** Pain at which the Session becomes easy low-impact work, or rest. */
export const PAIN_LOW_IMPACT = 5
/** Interval reps kept under the pain rule: about 30% fewer. */
export const PAIN_REPS_PERCENT = 70

/** What the pain rules make of a Session. */
export type PainLevel = 'ease' | 'low-impact'

/** The pain rules for a score, given the report before it. */
export function painLevel(score: number, previous: number | null): PainLevel | null {
  if (score >= PAIN_LOW_IMPACT) return 'low-impact'
  if (score >= PAIN_EASE || isRising(score, previous)) return 'ease'
  return null
}

/** Higher than the report before it. */
export const isRising = (score: number, previous: number | null) => score > 0 && previous !== null && score > previous

/** Reports oldest first: by day, then by the instant they were given. */
export function inOrder(reports: PainReport[]): PainReport[] {
  return [...reports].sort((a, b) => (a.date === b.date ? a.updatedAt.localeCompare(b.updatedAt) : a.date.localeCompare(b.date)))
}

/** The report standing on `today`, and the one before it: what "rising" compares against. */
export function standingPain(
  reports: PainReport[],
  today: LocalDate,
): { report: PainReport; previous: PainReport | null } | null {
  const past = inOrder(reports).filter((r) => r.date <= today)
  const report = past.at(-1)
  return report ? { report, previous: past.at(-2) ?? null } : null
}

/**
 * A Session under the pain rules. Anything pinned to a day (the race) stays
 * as it is: that's the athlete's call, not the Coach's.
 */
export function painAdapted(session: Session, level: PainLevel): Session {
  if (session.date) return session
  return level === 'low-impact' ? lowImpact(session) : eased(session)
}

/** Easy bike for no longer than the Session was, or rest. */
export const LOW_IMPACT_MINUTES = 30

function lowImpact(session: Session): Session {
  const minutes = Math.min(session.minutes, LOW_IMPACT_MINUTES)
  return {
    ...session,
    headline: `easy bike ${minutes}′ or rest`,
    minutes,
    note: 'Nothing that hurts.',
    blocks: [
      {
        name: 'Easy bike',
        minutes,
        main: true,
        exercises: [
          {
            name: 'Bike, easy',
            prescription: { kind: 'note', minutes },
            note: 'Easy bike, or rest. Nothing that hurts.',
          },
        ],
      },
    ],
  }
}

/** Jumps and accelerations to bike sprints, interval reps cut by about 30%. */
function eased(session: Session): Session {
  const reps = mainReps(session)
  const cut = reps === undefined ? undefined : fewerReps(reps)
  let saved = 0
  const blocks = session.blocks.map((block): Block => {
    const intervals = block.exercises.find((e) => e.prescription.kind === 'intervals')?.prescription
    let minutes = block.minutes
    if (intervals?.kind === 'intervals' && minutes !== undefined) {
      minutes = Math.round((minutes * fewerReps(intervals.reps)) / intervals.reps)
      saved += block.minutes! - minutes
    }
    const exercises = block.exercises.map(onTheBike)
    // A Block of jumps or accelerations, all gone to the bike, says so.
    const allBike = exercises.every((e, i) => e !== block.exercises[i] && e.prescription.kind === 'sprints')
    return { ...block, name: allBike ? 'Bike sprints' : block.name, minutes, exercises }
  })
  return {
    ...session,
    headline:
      reps === undefined || cut === undefined ? session.headline : session.headline.replace(/^\d+(?= × )/, String(cut)),
    minutes: session.minutes - saved,
    blocks,
  }
}

const fewerReps = (reps: number) => Math.max(1, Math.round((reps * PAIN_REPS_PERCENT) / 100))

function mainReps(session: Session): number | undefined {
  const rx = session.blocks
    .filter((b) => b.main)
    .flatMap((b) => b.exercises)
    .map((e) => e.prescription)
    .find((p) => p.kind === 'intervals')
  return rx?.kind === 'intervals' ? rx.reps : undefined
}

/** An Exercise Readiness can take off the floor goes to its bike option; interval reps drop. */
function onTheBike(exercise: Exercise): Exercise {
  const rx = exercise.prescription
  if (rx.kind === 'intervals') return { ...exercise, prescription: { ...rx, reps: fewerReps(rx.reps) } }
  const readiness = exercise.substitutions?.find((s) => s.when.includes('readiness'))
  if (!readiness) return exercise
  const bike = readiness.options.find((o) => /bike/i.test(o.name)) ?? readiness.options[0]
  return { ...bike, note: `Instead of ${exercise.name.toLowerCase()}: pain says no impact.` }
}

const ID = /^[a-z0-9-]{8,58}$/
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/

/** Checks an untrusted value (a request body, a stored row) and returns a clean report. Throws on anything else. */
export function parsePainReport(value: unknown): PainReport {
  if (typeof value !== 'object' || value === null) throw new Error('A pain report must be an object')
  const v = value as Record<string, unknown>
  if (typeof v.id !== 'string' || !ID.test(v.id)) throw new Error('id must be 8–58 lowercase letters, digits or -')
  if (typeof v.date !== 'string') throw new Error('date must be an ISO date')
  const date = localDate(v.date)
  const score = v.score
  if (!Number.isInteger(score) || (score as number) < 0 || (score as number) > 10) {
    throw new Error('score must be a whole number from 0 to 10')
  }
  const area = v.area ?? null
  if (area !== null && !PAIN_AREAS.includes(area as PainArea)) throw new Error(`area must be one of ${PAIN_AREAS.join(', ')}`)
  if (score === 0 && area !== null) throw new Error('No pain has no area')
  if (score !== 0 && area === null) throw new Error('Pain needs an area')
  const week = v.week ?? null
  const sessionId = v.sessionId ?? null
  if ((week === null) !== (sessionId === null)) throw new Error('week and sessionId go together')
  if (week !== null && (!Number.isInteger(week) || (week as number) < 1)) throw new Error('week must be a positive whole number')
  if (sessionId !== null && (typeof sessionId !== 'string' || sessionId.length === 0 || sessionId.length > 64)) {
    throw new Error('sessionId must be a short string')
  }
  const updatedAt = v.updatedAt
  if (typeof updatedAt !== 'string' || !INSTANT.test(updatedAt) || Number.isNaN(Date.parse(updatedAt))) {
    throw new Error('updatedAt must be an ISO instant in UTC')
  }
  return {
    id: v.id,
    date,
    score: score as number,
    area: area as PainArea | null,
    week: week as number | null,
    sessionId: sessionId as string | null,
    updatedAt,
  }
}

/** Both sets of reports, keeping the later edit of any report in both. */
export function mergePainReports(ours: PainReport[], theirs: PainReport[]): PainReport[] {
  const byId = new Map(ours.map((r) => [r.id, r]))
  for (const r of theirs) {
    const mine = byId.get(r.id)
    if (!mine || r.updatedAt > mine.updatedAt) byId.set(r.id, r)
  }
  return [...byId.values()]
}
