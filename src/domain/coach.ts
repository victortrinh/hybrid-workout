/**
 * The Coach: fixed rules that turn the Program into what to do today.
 *
 * Pure by design (ADR-0002): no I/O, no clock, no storage. Give it the
 * Program and today's date in America/Toronto and it answers the same way
 * every time, which is what makes it testable.
 */
import { matchActivities, type Activity, type ActivityAnswer, type ActivityOutcome } from './activity'
import { lightenWeek, RE_ENTRY_PERCENT } from './adapt'
import { addDays, daysBetween, mondayOf, type LocalDate } from './calendar'
import { DEFAULT_EQUIPMENT, equip, equipWeek, type Equipment } from './equipment'
import { logFor, trained, type LoggedStatus, type SessionLog } from './log'
import { painAdapted, painLevel, standingPain, type PainLevel, type PainReport } from './pain'
import { currentPaces, latestFiveKTest, type TrainingPaces } from './paces'
import {
  easyDayAdapted,
  readout,
  shortSleepAdapted,
  shortSleepCut,
  type Readout,
  type RecoveryNight,
  type ShortSleepCut,
} from './recovery'
import type { Phase, PhaseId, Program, Session, SessionType, Week } from './program/types'
import {
  decisionFor,
  painId,
  reEntryId,
  recoveryId,
  type PainSuggestion,
  type ReEntrySuggestion,
  type RecoverySuggestion,
  type Suggestion,
  type SuggestionDecision,
} from './suggestion'
import { startingWeights, type StartingPoint } from './startingPoint'
import { strengthState, type WorkingWeightChange, type WorkingWeights } from './weights'

export interface CoachInput {
  program: Program
  /** Today, as a calendar date in America/Toronto. */
  today: LocalDate
  /** Every Session log, from any Week. */
  logs?: SessionLog[]
  /** A Session the athlete tapped in the Bucket to do instead of Up next. Counts only on its `date`. */
  picked?: PickedSession | null
  /** The athlete's decisions on Suggestions. */
  decisions?: SuggestionDecision[]
  /** What the gym has: whatever it lacks, Substitutions stand in for. */
  equipment?: readonly Equipment[]
  /** Every Pain report, from any day. */
  painReports?: PainReport[]
  /** Every night of Recovery data the Shortcut has sent. */
  recoveryNights?: RecoveryNight[]
  /** Every workout the Workout Shortcut has sent. */
  activities?: Activity[]
  /** The athlete's answers to "Which Session was this?". */
  activityAnswers?: ActivityAnswer[]
  /** The estimates given at first launch, if any. */
  startingPoint?: StartingPoint | null
}

export interface PickedSession {
  date: LocalDate
  week: number
  sessionId: string
}

/** Where a Session of the Bucket stands: Planned and Next until something is logged. */
export type BucketState = 'planned' | 'next' | LoggedStatus

export interface BucketEntry {
  session: Session
  /** The Week the Session belongs to: last Week's, for a carried Key session. */
  week: number
  state: BucketState
  /** The log behind a logged state; null while Planned or Next. */
  log: SessionLog | null
  /** For last Week's Key session carried into this one: the last day it can be done. */
  carriedUntil: LocalDate | null
  /** The watch's workout attached to this Session, if any. */
  activity: Activity | null
  /** Whether it can be picked to do today: not a Session pinned to another day, like the race. */
  pickable: boolean
}

/** A workout more than one Session fits: Today asks which. */
export type ActivityQuestion = Extract<ActivityOutcome, { state: 'ambiguous' }>
export type ActivityAttached = Extract<ActivityOutcome, { state: 'attached' }> & { session: Session }

/** How far back Today still asks about a workout. */
export const ACTIVITY_QUESTION_DAYS = 7

/** Why there is no Up next today. */
export type RestReason =
  /** Every Session in the Bucket is logged. */
  | { kind: 'week-done' }
  /** A Hard session was done yesterday, or already today, and the Week has room to wait a day. */
  | { kind: 'hard-yesterday' | 'hard-today' }
  /** Only Speed is left, and Strength or HYROX was done yesterday or today. */
  | { kind: 'speed-after-load' }
  /** What's left is pinned to a later day: the race. */
  | { kind: 'waiting'; session: Session; date: LocalDate }

/** Where today falls in the Program. */
export type ProgramPosition =
  | { kind: 'before-start'; startsOn: LocalDate; daysToStart: number }
  | {
      kind: 'in-week'
      week: number
      phase: PhaseId
      startDate: LocalDate
      endDate: LocalDate
      /** Including today: 7 on a Monday, 1 on a Sunday. */
      daysLeft: number
    }
  | { kind: 'finished' }

export interface PhaseProgress {
  id: PhaseId
  name: string
  firstWeek: number
  lastWeek: number
  /** 0 to 1: the share of the Phase's Weeks already behind today. */
  completion: number
  current: boolean
}

export interface CoachDay {
  today: LocalDate
  raceDay: LocalDate
  /** 0 on Race day, negative after it. */
  daysToRace: number
  position: ProgramPosition
  phases: PhaseProgress[]
  /**
   * The Week whose Bucket Today shows: the current Week, or Week 1 before the
   * Program starts, with accepted Suggestions applied. Null after the Program,
   * or when that Week isn't encoded yet.
   */
  week: Week | null
  /**
   * Last Week's Key session while it is carried over, then that Week's
   * Sessions in display order, each with its state. Empty when there is no Week.
   */
  bucket: BucketEntry[]
  /** The one Session to do today. Null before the Program starts, after it ends, and on a rest day. */
  upNext: Session | null
  /** Why `upNext` is null while in a Week. */
  rest: RestReason | null
  /** The latest 5K test on or before today, which the Training paces come from. */
  fiveKTest: SessionLog | null
  /**
   * From the latest 5K test, or estimated from the Starting point before the
   * first one; null with neither, when every run is RPE only.
   */
  paces: TrainingPaces | null
  /**
   * The Suggestions for this Week, whatever their decision, then each lift's
   * latest Working weight Suggestion.
   */
  suggestions: Suggestion[]
  /** Each lift's Working weight; a lift without one is found in its next Strength session. */
  workingWeights: WorkingWeights
  /** The Starting point's estimates for lifts with no Working weight yet: where their calibration starts. */
  estimatedWeights: WorkingWeights
  /** Every time a Working weight was set or moved, oldest first. */
  workingWeightChanges: WorkingWeightChange[]
  /** The Pain report standing today, and what the pain rules make of it; null before the first. */
  pain: StandingPain | null
  /** Last night's Recovery data and what it means for today; null when the Shortcut sent none. */
  recovery: Readout | null
  /**
   * What last night did to Up next: a little less of the main Block and an
   * RPE cap, or (after the recovery Suggestion is accepted) an easy day. Null
   * when it changed nothing.
   */
  recoveryChange: 'short-sleep' | 'easy-day' | null
  /** On a short-sleep day, what came off Up next: a rep, a set, a round or a Station; null when only RPE is capped. */
  recoveryCut: ShortSleepCut | null
  /** Workouts from the last week that fit more than one Session, oldest first. */
  activityQuestions: ActivityQuestion[]
  /** Today's workouts the Coach attached on its own, oldest first: said once, so it's never silent. */
  activitiesAttached: ActivityAttached[]
}

export interface StandingPain {
  report: PainReport
  /** The report before it, which "rising" compares against. */
  previous: PainReport | null
  level: PainLevel | null
}

export function coach({
  program,
  today,
  logs = [],
  picked = null,
  decisions = [],
  equipment = DEFAULT_EQUIPMENT,
  painReports = [],
  recoveryNights = [],
  activities = [],
  activityAnswers = [],
  startingPoint = null,
}: CoachInput): CoachDay {
  const position = positionOf(program, today)
  const shownWeek =
    position.kind === 'in-week' ? position.week : position.kind === 'before-start' ? 1 : null
  const planned = shownWeek === null ? null : findWeek(program, shownWeek)
  const strength = strengthState(program, logs, decisions, today)
  const suggestions = [
    ...(position.kind === 'in-week' && planned
      ? suggestionsFor(program, planned, logs, decisions, { reports: painReports, today })
      : []),
    ...(position.kind === 'in-week' ? strength.suggestions : []),
  ]
  const week = planned && adapt(planned, suggestions, logs, equipment)

  const previous = position.kind === 'in-week' && week ? findWeek(program, week.number - 1) : null
  const carried = previous ? weekOutcome(program, previous, logs, today).carried : null
  const painNow = acceptedPain(suggestions)
  const logged: Logged[] = [
    ...(carried && previous
      ? [
          {
            session: equip(
              painNow && !logFor(logs, previous.number, carried.session.id)
                ? painAdapted(carried.session, painNow)
                : carried.session,
              equipment,
            ),
            week: previous.number,
            carriedUntil: carried.until,
          },
        ]
      : []),
    ...(week ? week.sessions.map((session) => ({ session, week: week.number, carriedUntil: null })) : []),
  ].map((entry) => ({ ...entry, log: logFor(logs, entry.week, entry.session.id) }))

  const chosen =
    position.kind === 'in-week' && week
      ? chooseUpNext({ program, logged, logs, today, picked, daysLeft: position.daysLeft })
      : // Before the Program nothing is Up next until the athlete picks a Week 1 Session to do early.
        { upNext: position.kind === 'before-start' ? pickedToday(logged, picked, today) : null, rest: null }
  const { rest } = chosen
  const recovery = readout(recoveryNights, today)
  const recovered = recoveryFor(chosen.upNext, recovery, today, decisions)
  if (recovered.suggestion) suggestions.push(recovered.suggestion)
  const upNext = recovered.upNext
  if (upNext !== chosen.upNext) logged[logged.indexOf(chosen.upNext!)] = upNext!
  const fiveKTest = latestFiveKTest(logs, today)
  const standing = standingPain(painReports, today)
  const matched = matchActivities(program, activities, logs, activityAnswers)
  const attached = new Map(
    matched.flatMap((o) => (o.state === 'attached' ? [[`${o.week}/${o.sessionId}`, o.activity] as const] : [])),
  )

  return {
    today,
    raceDay: program.raceDay,
    daysToRace: daysBetween(today, program.raceDay),
    position,
    phases: program.phases.map((phase) => phaseProgress(phase, position)),
    week,
    bucket: logged.map((entry) => ({
      ...entry,
      state: entry.log ? entry.log.status : entry === upNext ? 'next' : 'planned',
      activity: attached.get(`${entry.week}/${entry.session.id}`) ?? null,
      pickable: pickableOn(entry.session, today),
    })),
    upNext: upNext?.session ?? null,
    rest,
    fiveKTest,
    paces: currentPaces(logs, today, startingPoint?.fiveKSeconds ?? null),
    suggestions,
    workingWeights: strength.weights,
    estimatedWeights: startingWeights(startingPoint, strength.weights),
    workingWeightChanges: strength.changes,
    pain: standing && { ...standing, level: painLevel(standing.report.score, standing.previous?.score ?? null) },
    recovery,
    recoveryChange: recovered.change,
    recoveryCut: recovered.cut,
    activityQuestions: matched
      .filter((o): o is ActivityQuestion => o.state === 'ambiguous')
      .filter((o) => o.activity.date <= today && daysBetween(o.activity.date, today) < ACTIVITY_QUESTION_DAYS)
      .sort((a, b) => a.activity.startedAt.localeCompare(b.activity.startedAt)),
    activitiesAttached: matched
      .flatMap((o): ActivityAttached[] => {
        if (o.state !== 'attached' || o.by !== 'coach' || o.activity.date !== today) return []
        const session = findWeek(program, o.week)?.sessions.find((s) => s.id === o.sessionId)
        return session ? [{ ...o, session }] : []
      })
      .sort((a, b) => a.activity.startedAt.localeCompare(b.activity.startedAt)),
  }
}

interface Logged {
  session: Session
  week: number
  log: SessionLog | null
  carriedUntil: LocalDate | null
}

/** Week 1's Monday: Race week's Monday, counted back `weekCount - 1` Weeks. */
export function programStart(program: Program): LocalDate {
  return addDays(mondayOf(program.raceDay), -7 * (program.weekCount - 1))
}

export function findWeek(program: Program, number: number): Week | null {
  for (const phase of program.phases) {
    const week = phase.weeks.find((w) => w.number === number)
    if (week) return week
  }
  return null
}

function positionOf(program: Program, today: LocalDate): ProgramPosition {
  const start = programStart(program)
  const offset = daysBetween(start, today)
  if (offset < 0) return { kind: 'before-start', startsOn: start, daysToStart: -offset }

  const week = Math.floor(offset / 7) + 1
  if (week > program.weekCount) return { kind: 'finished' }

  const startDate = addDays(start, (week - 1) * 7)
  return {
    kind: 'in-week',
    week,
    phase: phaseOfWeek(program, week).id,
    startDate,
    endDate: addDays(startDate, 6),
    daysLeft: 7 - (offset % 7),
  }
}

function phaseOfWeek(program: Program, week: number): Phase {
  const phase = program.phases.find((p) => week >= p.firstWeek && week <= p.lastWeek)
  if (!phase) throw new Error(`Week ${week} belongs to no Phase`)
  return phase
}

function phaseProgress(phase: Phase, position: ProgramPosition): PhaseProgress {
  const length = phase.lastWeek - phase.firstWeek + 1
  const weeksBehind =
    position.kind === 'before-start'
      ? 0
      : position.kind === 'finished'
        ? length
        : Math.min(length, Math.max(0, position.week - phase.firstWeek))
  return {
    id: phase.id,
    name: phase.name,
    firstWeek: phase.firstWeek,
    lastWeek: phase.lastWeek,
    completion: weeksBehind / length,
    current: position.kind === 'in-week' && position.phase === phase.id,
  }
}

// ---------------------------------------------------------------------------
// Up next and the spacing rules (docs/training-plan.md, "How a Week works").

/** Every Session type but the Easy run. */
export const isHard = (type: SessionType) => type !== 'easy'
/** The 5K test takes the Speed session's place, so it follows the Speed rule. */
const isSpeed = (type: SessionType) => type === 'speed' || type === '5k-test'
/** What makes the legs too heavy for Speed the next day. */
const isLoad = (type: SessionType) => type === 'strength' || type === 'hyrox' || type === 'race-simulation'

interface UpNextInput {
  program: Program
  /** The Bucket's entries, oldest-waiting first. */
  logged: Logged[]
  logs: SessionLog[]
  today: LocalDate
  picked: PickedSession | null
  /** Days left in the Week, including today. */
  daysLeft: number
}

/**
 * The rules, in order:
 * 1. A Session the athlete picked today wins, as long as it is still open.
 * 2. A Session pinned to today (Race day) is Up next.
 * 3. The Optional session waits until nothing else is left to do before
 *    Sunday (Race week's shakeout only waits for nothing but the race).
 * 4. Never Speed the day after Strength or HYROX (or later the same day).
 * 5. No Hard session the day after another (or a second one the same day) when
 *    the Week has room to rest today and still fit the Hard sessions left.
 * 6. Of what remains, the Session waiting longest; within a Week, Bucket order.
 */
function chooseUpNext({ program, logged, logs, today, picked, daysLeft }: UpNextInput): {
  upNext: Logged | null
  rest: RestReason | null
} {
  const open = logged.filter((entry) => !entry.log)
  if (open.length === 0) return { upNext: null, rest: { kind: 'week-done' } }

  const choice = pickedToday(open, picked, today)
  if (choice) return { upNext: choice, rest: null }

  const pinnedToday = open.find((e) => e.session.date === today)
  if (pinnedToday) return { upNext: pinnedToday, rest: null }

  const available = open.filter((e) => !e.session.date)
  if (available.length === 0) {
    const pinned = open.find((e) => e.session.date)!.session
    return { upNext: null, rest: { kind: 'waiting', session: pinned, date: pinned.date! } }
  }
  const required = available.filter((e) => !e.session.optional)
  const pool = required.length > 0 ? required : available

  const yesterday = addDays(today, -1)
  const typesOn = (date: LocalDate) => trainedTypes(program, logs, date)
  const before = [...typesOn(yesterday), ...typesOn(today)]

  const allowed = before.some(isLoad) ? pool.filter((e) => !isSpeed(e.session.type)) : pool
  if (allowed.length === 0) return { upNext: null, rest: { kind: 'speed-after-load' } }

  const hardToday = typesOn(today).some(isHard)
  const hardYesterday = typesOn(yesterday).some(isHard)
  if (hardToday || hardYesterday) {
    const easy = allowed.filter((e) => !isHard(e.session.type))
    if (easy.length > 0) return { upNext: oldestWaiting(easy), rest: null }

    const hardLeft = available.filter((e) => isHard(e.session.type)).length
    // Resting today leaves `daysLeft - 1` days from tomorrow; tomorrow can't be Hard after a Hard today.
    if (hardLeft <= mostHardSessions(daysLeft - 1, hardToday)) {
      return { upNext: null, rest: { kind: hardToday ? 'hard-today' : 'hard-yesterday' } }
    }
  }

  return { upNext: oldestWaiting(allowed), rest: null }
}

/** The Session picked today, while it is still open and can be done today. */
function pickedToday(logged: Logged[], picked: PickedSession | null, today: LocalDate): Logged | null {
  if (!picked || picked.date !== today) return null
  return (
    logged.find(
      (e) => !e.log && e.week === picked.week && e.session.id === picked.sessionId && pickableOn(e.session, today),
    ) ?? null
  )
}

/** A Session pinned to a day, like the race, is done on that day and no other. */
const pickableOn = (session: Session, today: LocalDate) => !session.date || session.date === today

/** Session types logged as Done or Partial on `date`, from any Week. */
function trainedTypes(program: Program, logs: SessionLog[], date: LocalDate): SessionType[] {
  return logs
    .filter((log) => log.date === date && trained(log))
    .flatMap((log) => findWeek(program, log.week)?.sessions.find((s) => s.id === log.sessionId)?.type ?? [])
}

/** The most Hard sessions `days` days can hold with none on consecutive days. */
function mostHardSessions(days: number, firstDayBlocked: boolean): number {
  return Math.max(0, Math.ceil((days - (firstDayBlocked ? 1 : 0)) / 2))
}

/**
 * Every open Session of a Week has waited since its Monday, so Bucket order
 * breaks the tie. A Key session carried over from last Week comes first in
 * the Bucket: it has waited longest.
 */
function oldestWaiting(entries: Logged[]): Logged {
  return entries[0]
}

// ---------------------------------------------------------------------------
// Week rollover (docs/training-plan.md, "How a Week works"): the Key session
// carries over up to three days; anything else not done by Sunday is Skipped.

/** Days into the next Week a Key session stays open: Monday to Wednesday. */
export const CARRY_DAYS = 3

/**
 * The last day a Week's Key session can be done: Wednesday of the next Week.
 * Sunday where it can't carry: the last Week, and the Taper, whose Key
 * session never spills into Race week.
 */
export function keyDeadline(program: Program, week: Week): LocalDate {
  const sunday = addDays(week.startDate, 6)
  const next = findWeek(program, week.number + 1)
  return next && !next.race ? addDays(sunday, CARRY_DAYS) : sunday
}

export interface WeekOutcome {
  /**
   * Missed Sessions: logged Skipped by the athlete, or not done once the Week
   * (or, for the Key session, its carry-over) is over. The Optional session
   * is never a miss.
   */
  skipped: { session: Session; by: 'athlete' | 'coach' }[]
  /**
   * The Key session, not done by Sunday, while its carry-over lasts: open, or
   * logged on one of the carry-over days.
   */
  carried: { session: Session; until: LocalDate } | null
}

/** Where a Week stands on `today`: what was missed, and what is still carried. */
export function weekOutcome(program: Program, week: Week, logs: SessionLog[], today: LocalDate): WeekOutcome {
  const sunday = addDays(week.startDate, 6)
  const over = daysBetween(sunday, today) > 0
  const outcome: WeekOutcome = { skipped: [], carried: null }
  for (const session of week.sessions) {
    if (session.optional) continue
    const log = logFor(logs, week.number, session.id)
    const until = session.key ? keyDeadline(program, week) : null
    const carrying = over && until !== null && daysBetween(today, until) >= 0
    if (log) {
      if (log.status === 'skipped') outcome.skipped.push({ session, by: 'athlete' })
      if (carrying && daysBetween(sunday, log.date) > 0) outcome.carried = { session, until }
      continue
    }
    if (!over) continue
    if (carrying) outcome.carried = { session, until }
    else outcome.skipped.push({ session, by: 'coach' })
  }
  return outcome
}

// ---------------------------------------------------------------------------
// Suggestions. Each is derived from the logs; only the decision is stored.
// Working weight Suggestions are replayed in weights.ts.

/** Skipped Sessions in a Week that make the next one a lighter re-entry. */
export const RE_ENTRY_SKIPS = 2

/** Pain reports, and the day they are read on: pain only changes the Week holding today. */
interface PainInput {
  reports: PainReport[]
  today: LocalDate
  /** A Session of this Week done today, early or late: today's pain counts for it too. */
  doneToday?: boolean
}

function suggestionsFor(
  program: Program,
  week: Week,
  logs: SessionLog[],
  decisions: SuggestionDecision[],
  pain: PainInput | null,
): Suggestion[] {
  const reEntry = reEntryFor(program, week, logs, decisions)
  const painful = pain && painFor(week, pain, decisions)
  return [...(reEntry ? [reEntry] : []), ...(painful ? [painful] : [])]
}

/**
 * The pain rules, while a Pain report of 3 or more, or a rising one, stands:
 * bike for jumps and accelerations and about 30% fewer reps, or from 5 easy
 * low-impact work or rest. Only for the Week holding today, or a Session of
 * another Week done today.
 */
function painFor(
  week: Week,
  { reports, today, doneToday = false }: PainInput,
  decisions: SuggestionDecision[],
): PainSuggestion | null {
  const offset = daysBetween(week.startDate, today)
  if (!doneToday && (offset < 0 || offset > 6)) return null
  const standing = standingPain(reports, today)
  if (!standing) return null
  const { report, previous } = standing
  const level = painLevel(report.score, previous?.score ?? null)
  if (!level) return null

  const id = painId(report.id)
  const decided = decisionFor(decisions, id)
  return {
    id,
    kind: 'pain',
    week: week.number,
    sessionId: null,
    date: report.date,
    level,
    trigger: {
      score: report.score,
      area: report.area,
      risingFrom: previous && report.score > previous.score ? previous.score : null,
    },
    decision: decided?.decision ?? 'open',
    decidedOn: decided?.date ?? null,
  }
}

/**
 * The recovery rules, for today's Up next only, when it is a Hard session:
 * sleep under 6 hours takes a rep, set, round or Station off (by Session
 * type) and caps RPE; with HRV at least 15%
 * under its mean too, the Coach suggests an easy day, which replaces both
 * once accepted. A day without a night changes nothing.
 */
function recoveryFor(
  upNext: Logged | null,
  recovery: Readout | null,
  today: LocalDate,
  decisions: SuggestionDecision[],
): {
  upNext: Logged | null
  suggestion: RecoverySuggestion | null
  change: CoachDay['recoveryChange']
  cut: ShortSleepCut | null
} {
  const unchanged = { upNext, suggestion: null, change: null, cut: null }
  if (!upNext || !recovery?.shortSleep || !isHard(upNext.session.type) || upNext.session.date) return unchanged

  const cut = shortSleepCut(upNext.session)

  let suggestion: RecoverySuggestion | null = null
  if (recovery.easyDay) {
    const id = recoveryId(today)
    const decided = decisionFor(decisions, id)
    suggestion = {
      id,
      kind: 'recovery',
      week: upNext.week,
      sessionId: upNext.session.id,
      date: today,
      cut,
      trigger: {
        sleepMinutes: recovery.night.sleepMinutes,
        hrvMs: recovery.night.hrvMs!,
        hrvMean: recovery.hrvMean!,
      },
      decision: decided?.decision ?? 'open',
      decidedOn: decided?.date ?? null,
    }
  }
  if (suggestion?.decision === 'accepted') {
    return { upNext: { ...upNext, session: easyDayAdapted(upNext.session) }, suggestion, change: 'easy-day', cut: null }
  }
  const session = shortSleepAdapted(upNext.session, recovery.night)
  return session === upNext.session
    ? { ...unchanged, suggestion }
    : { upNext: { ...upNext, session }, suggestion, change: 'short-sleep', cut }
}

const acceptedPain = (suggestions: Suggestion[]): PainLevel | null =>
  suggestions.find((s): s is PainSuggestion => s.kind === 'pain' && s.decision === 'accepted')?.level ?? null

/**
 * Two or more Sessions Skipped last Week: suggest this Week a third lighter.
 * Counted as the Week closed on Sunday, so a Key session still carried over
 * isn't a miss yet, and a Session made up late, from this Monday on, doesn't
 * undo one: a late make-up never cancels the lighter Week. Deload weeks are lighter already, and the Taper follows
 * the race-week rules, so neither gets one.
 */
function reEntryFor(
  program: Program,
  week: Week,
  logs: SessionLog[],
  decisions: SuggestionDecision[],
): ReEntrySuggestion | null {
  const previous = findWeek(program, week.number - 1)
  if (!previous || week.deload || phaseOfWeek(program, week.number).id === 'taper') return null

  const closed = logs.filter((log) => !trained(log) || daysBetween(log.date, week.startDate) > 0)
  const { skipped } = weekOutcome(program, previous, closed, week.startDate)
  if (skipped.length < RE_ENTRY_SKIPS) return null

  const id = reEntryId(week.number)
  const decided = decisionFor(decisions, id)
  return {
    id,
    kind: 're-entry',
    week: week.number,
    sessionId: null,
    date: week.startDate,
    from: { volumePercent: 100 },
    to: { volumePercent: RE_ENTRY_PERCENT },
    trigger: {
      week: previous.number,
      skipped: skipped.map(({ session }) => ({ sessionId: session.id, type: session.type })),
    },
    decision: decided?.decision ?? 'open',
    decidedOn: decided?.date ?? null,
  }
}

/**
 * The Week with every accepted Suggestion applied, as it's done in this gym.
 * The pain rules change only what is still open: a Session logged before the
 * pain stays as it was.
 */
function adapt(week: Week, suggestions: Suggestion[], logs: SessionLog[], equipment: readonly Equipment[]): Week {
  return equipWeek(
    suggestions.reduce((adapted, s) => {
      if (s.decision !== 'accepted' || s.week !== adapted.number) return adapted
      switch (s.kind) {
        case 're-entry':
          return lightenWeek(adapted, s.to.volumePercent)
        case 'pain':
          return {
            ...adapted,
            sessions: adapted.sessions.map((session) =>
              logFor(logs, adapted.number, session.id) ? session : painAdapted(session, s.level),
            ),
          }
        case 'working-weight':
          // Moves a lift's Working weight, not the Prescription: the load is resolved on Start.
          return adapted
        case 'recovery':
          // Today's Up next only: the Coach applies it once Up next is chosen.
          return adapted
      }
    }, week),
    equipment,
  )
}

/**
 * A Week as it will be trained: the Program's Week with accepted Suggestions
 * applied. For screens that show a Week other than today's; with `pain`, the
 * pain rules apply to the Week holding its `today`.
 */
export function prescribedWeek(
  program: Program,
  number: number,
  logs: SessionLog[],
  decisions: SuggestionDecision[],
  equipment: readonly Equipment[] = DEFAULT_EQUIPMENT,
  pain: PainInput | null = null,
): Week | null {
  const week = findWeek(program, number)
  return week && adapt(week, suggestionsFor(program, week, logs, decisions, pain), logs, equipment)
}
