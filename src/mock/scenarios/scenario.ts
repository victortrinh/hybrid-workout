/**
 * A scenario: one state of the Program to QA in mock mode (ADR-0005). It
 * pins the day the app thinks it is, fills every server table, the Starting
 * point among them (skipped unless it says otherwise), and sets what
 * the device keeps: settings, Environment overrides, and a Live session left
 * running.
 */
import { addDays, localDate, type LocalDate } from '../../domain/calendar'
import type { ActivityAnswer } from '../../domain/activity'
import type { LiveSession } from '../../domain/lifts'
import type { SessionLog } from '../../domain/log'
import type { PainReport } from '../../domain/pain'
import type { Environment } from '../../domain/paces'
import type { Settings } from '../../domain/settings'
import { SKIPPED, type StartingPoint } from '../../domain/startingPoint'
import type { SuggestionDecision } from '../../domain/suggestion'

/** A night as the morning Shortcut sends it to /api/recovery. */
export interface NightSend {
  date: string
  sleepMinutes: number
  hrvMs: number | null
  restingHeartRate: number | null
  source: string
}

/** A workout as the Workout Shortcut sends it to /api/activities. */
export interface WorkoutSend {
  type: string
  /** UTC instants. */
  start: string
  end: string
  distanceKm?: number
  averageHeartRate?: number
  maxHeartRate?: number
  indoor?: boolean
}

export interface Scenario {
  /** Its `?scenario=` name. */
  name: string
  /** What it QAs, in a line, for the picker. */
  summary: string
  /** The day the app thinks it is, in America/Toronto. */
  today: LocalDate
  /** The time it is when the scenario loads, `HH:MM` in Toronto; it ticks on from there. */
  time: string
  server: {
    sessionLogs: SessionLog[]
    suggestionDecisions: SuggestionDecision[]
    painReports: PainReport[]
    recoveryNights: NightSend[]
    activities: WorkoutSend[]
    activityAnswers: ActivityAnswer[]
    /** Null for a first launch, which shows the Starting point screen; skipped unless a scenario says otherwise. */
    startingPoint: StartingPoint | null
  }
  device: {
    settings: Partial<Settings>
    /** Per-Session Environment overrides, keyed `week/sessionId`. */
    environment: Record<string, Environment>
    /** A Live session left running, started from `now`, the pinned clock at load. */
    live: ((now: number) => LiveSession) | null
  }
}

type Definition = Pick<Scenario, 'name' | 'summary'> & {
  today: string
  time?: string
  server?: Partial<Scenario['server']>
  device?: Partial<Scenario['device']>
}

export function scenario({ name, summary, today, time = '08:00', server = {}, device = {} }: Definition): Scenario {
  return {
    name,
    summary,
    today: localDate(today),
    time,
    server: {
      sessionLogs: [],
      suggestionDecisions: [],
      painReports: [],
      recoveryNights: [],
      activities: [],
      activityAnswers: [],
      startingPoint: { ...SKIPPED, updatedAt: `${today}T00:00:00.000Z` },
      ...server,
    },
    device: { settings: {}, environment: {}, live: null, ...device },
  }
}

/**
 * The ring's nights from `from` to `to`, a steady sleeper around 7 h 20 and
 * HRV in the mid 50s, varied a little night to night. `change` rewrites any
 * night, or drops it by returning null.
 */
export function nights(
  from: string,
  to: string,
  change: (night: NightSend, i: number) => NightSend | null = (n) => n,
): NightSend[] {
  const sent: NightSend[] = []
  const last = localDate(to)
  for (let date = localDate(from), i = 0; date <= last; date = addDays(date, 1), i++) {
    const wobble = [0, 12, -8, 20, -15, 5, -4][i % 7]
    const night = change(
      {
        date,
        sleepMinutes: 440 + wobble,
        hrvMs: 55 + Math.round(wobble / 4),
        restingHeartRate: 50 - Math.round(wobble / 10),
        source: 'Ultrahuman',
      },
      i,
    )
    if (night) sent.push(night)
  }
  return sent
}

/** A watch workout starting at `utc` (`HH:MM`, UTC) on `date`. */
export function workout(
  date: string,
  utc: string,
  type: string,
  minutes: number,
  more: Omit<WorkoutSend, 'type' | 'start' | 'end'> = {},
): WorkoutSend {
  const start = new Date(`${date}T${utc}:00Z`)
  const end = new Date(start.getTime() + minutes * 60_000)
  const iso = (d: Date) => d.toISOString().slice(0, 19) + 'Z'
  return { type, start: iso(start), end: iso(end), averageHeartRate: 142, maxHeartRate: 171, ...more }
}
