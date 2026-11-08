/**
 * The Coach: fixed rules that turn the Program into what to do today.
 *
 * Pure by design (ADR-0002): no I/O, no clock, no storage. Give it the
 * Program and today's date in America/Toronto and it answers the same way
 * every time, which is what makes it testable.
 */
import { matchActivities, type Activity, type ActivityAnswer, type ActivityOutcome } from './activity'
import { lighten, RE_ENTRY_PERCENT } from './adapt'
import { addDays, daysBetween, mondayOf, type LocalDate } from './calendar'
import { DEFAULT_EQUIPMENT, equip, equipWeek, type Equipment } from './equipment'
import { logFor, offeredSessions, trained, type LoggedStatus, type SessionLog } from './log'
import { inOrder, painAdapted, painLevel, standingPain, type PainLevel, type PainReport } from './pain'
import { currentPaces, type TrainingPaces } from './paces'
import {
  easyDayAdapted,
  isShortSleep,
  nightOf,
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
  lighterWeekId,
  painId,
  reEntryId,
  recoveryId,
  type LighterWeekSuggestion,
  type PainSuggestion,
  type ReadinessFlag,
  type ReEntrySuggestion,
  type RecoverySuggestion,
  type Suggestion,
  type SuggestionDecision,
} from './suggestion'
import { startingWeights, type StartingPoint } from './startingPoint'
import { strengthState, type HeldIncrease, type LighterSpan, type WorkingWeightChange, type WorkingWeights } from './weights'

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

/** Where a Session of the Bucket stands: Planned until something is logged; Next for Up next, a Skipped one too. */
export type BucketState = 'planned' | 'next' | LoggedStatus

export interface BucketEntry {
  session: Session
  /** The Week the Session belongs to: an earlier one, for a Late session. */
  week: number
  state: BucketState
  /** The log behind a logged state; null while Planned or Next. */
  log: SessionLog | null
  /** A required Session of a Week that is over: not logged yet, or logged today. */
  late: boolean
  /** The watch's workout attached to this Session, if any. */
  activity: Activity | null
  /** Whether it can be picked to do today: not a Session pinned to another day, like the race. */
  pickable: boolean
  /** Still to do: nothing logged, or a required Session of this Week Skipped while it has days left. */
  toDo: boolean
}

/** A workout more than one Session fits: Today asks which. */
export type ActivityQuestion = Extract<ActivityOutcome, { state: 'ambiguous' }>
export type ActivityAttached = Extract<ActivityOutcome, { state: 'attached' }> & {
  session: Session
  /** Whether the Session has a log yet: attaching a workout never logs it. */
  logged: boolean
}

/** How far back Today still asks about a workout. */
export const ACTIVITY_QUESTION_DAYS = 7

/** Why there is no Up next today. */
export type RestReason =
  /** Every required Session is Done, Partial or Swapped, and the Optional session is logged. */
  | { kind: 'week-done' }
  /**
   * All that's left was Skipped today: it waits for tomorrow, or, on its last
   * day, closes the Week as a miss.
   */
  | { kind: 'skipped-today'; sessions: Session[]; lastDay: boolean }
  /**
   * A Hard session was done yesterday, or already today, and the Week has room
   * to wait a day. Only suggested: `anyway` is the Session to do instead.
   */
  | { kind: 'hard-yesterday' | 'hard-today'; anyway: RestAnyway }
  /** Only the Run is left, and Strength was done yesterday or today. Only suggested, like the above. */
  | { kind: 'run-after-load'; anyway: RestAnyway }
  /** What's left is pinned to a later day: the race. */
  | { kind: 'waiting'; session: Session; date: LocalDate }

/**
 * The Session a suggested rest stands in front of: Do it anyway picks it for
 * today, as a Bucket pick does (ADR-0007).
 */
export interface RestAnyway {
  week: number
  session: Session
}

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
   * The Late sessions, oldest Week first, then the Week's Sessions in display
   * order, each with its state. Empty when there is no Week.
   */
  bucket: BucketEntry[]
  /** In Catch-up: how many Late sessions wait, and the oldest Week they're from. Null when nothing is late. */
  behind: { sessions: number; week: number } | null
  /** From the first day of Race specific, the Late sessions it dropped, said once: null when none, or once dismissed. */
  dropped: Dropped | null
  /** The one Session to do today. Null before the Program starts, after it ends, and on a rest day. */
  upNext: Session | null
  /** Why `upNext` is null while in a Week. */
  rest: RestReason | null
  /** Estimated from the Starting point; null without one, when every run is RPE only. */
  paces: TrainingPaces | null
  /**
   * The Suggestions for this Week, whatever their decision, then each lift's
   * latest Working weight Suggestion.
   */
  suggestions: Suggestion[]
  /**
   * Increases earned but held while this lighter Week (a Deload week, or an
   * accepted re-entry) is in force: not offered, they land the Monday after.
   */
  heldIncreases: HeldIncrease[]
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
  /** On a short-sleep day, what came off Up next: a rep, a round or a Station; null when only RPE is capped. */
  recoveryCut: ShortSleepCut | null
  /** Workouts from the last week that fit more than one Session, oldest first. */
  activityQuestions: ActivityQuestion[]
  /**
   * Workouts attached to a Session, oldest first: today's that the Coach
   * attached on its own, said once so it's never silent, and any from the
   * last week whose Session isn't logged yet, so logging it is one tap.
   */
  activitiesAttached: ActivityAttached[]
}

/** The Late sessions Coach-Skipped when Race specific started, and the Weeks they came from (ADR-0007). */
export interface Dropped {
  /** The id its dismissal is stored under, like a Suggestion's decision. */
  id: string
  sessions: number
  firstWeek: number
  lastWeek: number
}

/** The id the dismissal of the Race specific notice is stored under. */
export const DROPPED_ID = 'dropped-race-specific'

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
  const listed = shownWeek === null ? null : findWeek(program, shownWeek)
  const planned = listed && offeredSessions(program, listed, logs)
  const readiness: ReadinessInput = { reports: painReports, nights: recoveryNights, today }
  const strength = strengthState(program, logs, decisions, today, lighterSpans(program, logs, decisions, today, readiness))
  const suggestions = [
    ...(position.kind === 'in-week' && planned
      ? suggestionsFor(program, planned, logs, decisions, readiness, today)
      : []),
    ...(position.kind === 'in-week' ? strength.suggestions : []),
  ]
  const week = planned && adapt(planned, suggestions, logs, equipment)

  const painNow = acceptedPain(suggestions)
  const logged: Logged[] = [
    ...(position.kind === 'in-week' && week ? lateSessions(program, week.number, logs, decisions, equipment, today) : []).map(
      // Pain is about the body today: it changes a Late session still open, like any other.
      (entry) => (painNow && !entry.log ? { ...entry, session: painAdapted(entry.session, painNow) } : entry),
    ),
    ...(week
      ? week.sessions.map((session) => ({ session, week: week.number, late: false, log: logFor(logs, week.number, session.id) }))
      : []),
  ]
  const lateOpen = logged.filter((e) => e.late && !e.log)
  // A re-entry for a Late Week: Today offers it alongside the current Week's.
  const lateWeeks = [...new Set(logged.filter((e) => e.late).map((e) => e.week))]
  suggestions.unshift(...lateWeeks.flatMap((n) => reEntryFor(program, findWeek(program, n)!, logs, decisions, today) ?? []))

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
      state: entry === upNext ? 'next' : entry.log ? entry.log.status : 'planned',
      activity: attached.get(`${entry.week}/${entry.session.id}`) ?? null,
      pickable: pickableOn(entry.session, today),
      toDo: toDo(entry),
    })),
    behind: lateOpen.length > 0 ? { sessions: lateOpen.length, week: lateOpen[0].week } : null,
    dropped: droppedFor(program, logs, decisions, today),
    upNext: upNext?.session ?? null,
    rest,
    paces: currentPaces(logs, startingPoint?.splitSeconds ?? null, today),
    suggestions,
    heldIncreases: position.kind === 'in-week' ? strength.held : [],
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
        if (o.state !== 'attached' || o.activity.date > today) return []
        const logged = logs.some((l) => l.week === o.week && l.sessionId === o.sessionId)
        const said = o.by === 'coach' && o.activity.date === today
        if (!said && (logged || daysBetween(o.activity.date, today) >= ACTIVITY_QUESTION_DAYS)) return []
        const session = findWeek(program, o.week)?.sessions.find((s) => s.id === o.sessionId)
        return session ? [{ ...o, session, logged }] : []
      })
      .sort((a, b) => a.activity.startedAt.localeCompare(b.activity.startedAt)),
  }
}

interface Logged {
  session: Session
  week: number
  log: SessionLog | null
  late: boolean
}

/**
 * A Skipped log doesn't close a required Session: it can still be done while
 * its Week has days left. Skipping the Optional session closes it, and so does
 * skipping a Late session: the athlete's own "not doing this one".
 */
const toDo = ({ session, log, late }: Pick<Logged, 'session' | 'log' | 'late'>) =>
  !log || (log.status === 'skipped' && !session.optional && !late)

/**
 * Catch-up (ADR-0007): the required Sessions of the Weeks before `current`
 * with no log, oldest Week first, each with its own Week's Prescription. One
 * logged today stays, with its log, until tomorrow. The Optional session is
 * never Late, and from the first day of Race specific nothing is: the
 * calendar takes over again.
 */
function lateSessions(
  program: Program,
  current: number,
  logs: SessionLog[],
  decisions: SuggestionDecision[],
  equipment: readonly Equipment[],
  today: LocalDate,
): Logged[] {
  if (calendarAgain(program, today)) return []
  return program.phases
    .flatMap((phase) => phase.weeks)
    .filter((week) => week.number < current)
    .flatMap((week) => {
      const late = week.sessions.filter((session) => {
        if (session.optional || session.date) return false
        const log = logFor(logs, week.number, session.id)
        return !log || log.date === today
      })
      if (late.length === 0) return []
      const prescribed = adapt(week, suggestionsFor(program, week, logs, decisions, null, today), logs, equipment)
      return late.map((session) => ({
        session: prescribed.sessions.find((s) => s.id === session.id) ?? equip(session, equipment),
        week: week.number,
        late: true,
        log: logFor(logs, week.number, session.id),
      }))
    })
}

/**
 * Race day doesn't move, so Catch-up stops on the first Monday of Race
 * specific: from that day a Session not done by its Week's Sunday is missed,
 * Skipped by the Coach (ADR-0007).
 */
export function raceSpecificStart(program: Program): LocalDate {
  const phase = program.phases.find((p) => p.id === 'race-specific')!
  return addDays(programStart(program), 7 * (phase.firstWeek - 1))
}

const calendarAgain = (program: Program, today: LocalDate) => daysBetween(raceSpecificStart(program), today) >= 0

/** The Late sessions Race specific dropped: the Coach's Skips in the Weeks before it. Null once dismissed. */
function droppedFor(
  program: Program,
  logs: SessionLog[],
  decisions: SuggestionDecision[],
  today: LocalDate,
): Dropped | null {
  if (!calendarAgain(program, today)) return null
  const dismissed = decisionFor(decisions, DROPPED_ID)
  if (dismissed && dismissed.decision !== 'open') return null
  const start = raceSpecificStart(program)
  const weeks = program.phases
    .flatMap((phase) => phase.weeks)
    .filter((week) => daysBetween(week.startDate, start) > 0)
    .map((week) => ({
      week: week.number,
      sessions: weekOutcome(program, week, logs, start).skipped.filter((s) => s.by === 'coach').length,
    }))
    .filter((w) => w.sessions > 0)
  if (weeks.length === 0) return null
  return {
    id: DROPPED_ID,
    sessions: weeks.reduce((sum, w) => sum + w.sessions, 0),
    firstWeek: weeks[0].week,
    lastWeek: weeks.at(-1)!.week,
  }
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
/** The Compromised run test takes the Run's place, so it follows the Run's rule. */
const isRun = (type: SessionType) => type === 'run' || type === 'compromised-run-test'
/** What makes the legs too heavy for the Run the next day: Strength only, not HYROX. */
const isLoad = (type: SessionType) => type === 'strength'

interface UpNextInput {
  program: Program
  /** The Bucket's entries, Late sessions first, oldest Week first. */
  logged: Logged[]
  logs: SessionLog[]
  today: LocalDate
  picked: PickedSession | null
  /** Days left in the Week, including today. */
  daysLeft: number
}

/**
 * In Catch-up, Up next comes from the oldest Week's Late sessions, which have
 * no days left to rest in; the Week holding today only once nothing is late.
 *
 * The rules, in order:
 * 1. A Session the athlete picked today wins, as long as it is still open.
 * 2. A Session pinned to today (Race day) is Up next.
 * 3. The Optional session waits until nothing else is left to do before
 *    Sunday (Race week's shakeout only waits for nothing but the race).
 * 4. Never the Run the day after Strength (or later the same day).
 * 5. No Hard session the day after another (or a second one the same day) when
 *    the Week has room to rest today and still fit the Hard sessions left.
 *    Rules 4 and 5 only suggest the rest: rule 1 taps past it.
 * 6. Of what remains, the Session waiting longest; within a Week, Bucket order.
 */
function chooseUpNext(input: UpNextInput): { upNext: Logged | null; rest: RestReason | null } {
  const { logged, today, picked } = input
  const late = logged.filter((e) => e.late && !e.log)
  if (late.length === 0) return chooseAmong(logged.filter((e) => !e.late), input)

  const choice = pickedToday(logged, picked, today)
  if (choice) return { upNext: choice, rest: null }
  return chooseAmong(late.filter((e) => e.week === late[0].week), { ...input, daysLeft: 0 })
}

function chooseAmong(
  logged: Logged[],
  { program, logs, today, picked, daysLeft }: UpNextInput,
): { upNext: Logged | null; rest: RestReason | null } {
  // Untouched Sessions first; a Skipped one comes back after them, and not the day it was Skipped.
  const skipped = logged.filter((e) => e.log && toDo(e))
  const skippedToday = skipped.filter((e) => e.log!.date === today)
  const open = [...logged.filter((e) => !e.log), ...skipped.filter((e) => e.log!.date !== today)]
  if (open.length === 0) {
    if (skippedToday.length === 0) return { upNext: null, rest: { kind: 'week-done' } }
    const lastDay = daysLeft === 1
    return { upNext: null, rest: { kind: 'skipped-today', sessions: skippedToday.map((e) => e.session), lastDay } }
  }

  const choice = pickedToday(logged, picked, today)
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

  const allowed = before.some(isLoad) ? pool.filter((e) => !isRun(e.session.type)) : pool
  if (allowed.length === 0) return { upNext: null, rest: { kind: 'run-after-load', anyway: anyway(pool) } }

  const hardToday = typesOn(today).some(isHard)
  const hardYesterday = typesOn(yesterday).some(isHard)
  if (hardToday || hardYesterday) {
    const easy = allowed.filter((e) => !isHard(e.session.type))
    if (easy.length > 0) return { upNext: oldestWaiting(easy), rest: null }

    const hardLeft = available.filter((e) => isHard(e.session.type)).length
    // Resting today leaves `daysLeft - 1` days from tomorrow; tomorrow can't be Hard after a Hard today.
    if (hardLeft <= mostHardSessions(daysLeft - 1, hardToday)) {
      return { upNext: null, rest: { kind: hardToday ? 'hard-today' : 'hard-yesterday', anyway: anyway(allowed) } }
    }
  }

  return { upNext: oldestWaiting(allowed), rest: null }
}

/** What a suggested rest gives way to when tapped past: the Session waiting longest. */
function anyway(entries: Logged[]): RestAnyway {
  const { week, session } = oldestWaiting(entries)
  return { week, session }
}

/** The Session picked today, while it is still open and can be done today. */
function pickedToday(logged: Logged[], picked: PickedSession | null, today: LocalDate): Logged | null {
  if (!picked || picked.date !== today) return null
  return (
    logged.find(
      (e) => toDo(e) && e.week === picked.week && e.session.id === picked.sessionId && pickableOn(e.session, today),
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

/** Every open Session of a Week has waited since its Monday, so Bucket order breaks the tie. */
function oldestWaiting(entries: Logged[]): Logged {
  return entries[0]
}

// ---------------------------------------------------------------------------
// Week rollover: a Week that is over keeps its required Sessions with no log
// as Late sessions (Catch-up, ADR-0007), and only the athlete's Skips are
// misses, until Race specific starts: from then on the Coach Skips them.

export interface WeekOutcome {
  /**
   * Missed Sessions, once the Week is over: logged Skipped by the athlete, or,
   * from the first day of Race specific, never logged and Skipped by the Coach.
   * The Optional session is never a miss; before Race specific a Session with
   * no log is Late, not missed.
   */
  skipped: { session: Session; by: 'athlete' | 'coach' }[]
}

/** What a Week missed, as of `today`. */
export function weekOutcome(program: Program, week: Week, logs: SessionLog[], today: LocalDate): WeekOutcome {
  const over = daysBetween(addDays(week.startDate, 6), today) > 0
  const outcome: WeekOutcome = { skipped: [] }
  if (!over) return outcome
  const calendar = calendarAgain(program, today)
  for (const session of week.sessions) {
    if (session.optional) continue
    const log = logFor(logs, week.number, session.id)
    // Skipped can still be done until the Week is over.
    if (log?.status === 'skipped') outcome.skipped.push({ session, by: 'athlete' })
    else if (!log && calendar) outcome.skipped.push({ session, by: 'coach' })
  }
  return outcome
}

// ---------------------------------------------------------------------------
// Suggestions. Each is derived from the logs; only the decision is stored.
// Working weight Suggestions are replayed in weights.ts.

/** Days since the last Done or Partial Session that make the rest of a Week a lighter re-entry. */
export const RE_ENTRY_DAYS = 7

/**
 * Readiness, and the day it is read on: pain only changes the Week holding
 * today; the nights, with the reports, count the Week's Readiness flags.
 */
export interface ReadinessInput {
  reports: PainReport[]
  /** Without them, only pain flags the Week. */
  nights?: RecoveryNight[]
  today: LocalDate
  /** A Session of this Week done today, early or late: today's pain counts for it too. */
  doneToday?: boolean
}

function suggestionsFor(
  program: Program,
  week: Week,
  logs: SessionLog[],
  decisions: SuggestionDecision[],
  readiness: ReadinessInput | null,
  /** Null when no day is given: a gap still open today isn't seen then, only one a log has closed. */
  today: LocalDate | null,
): Suggestion[] {
  const reEntry = reEntryFor(program, week, logs, decisions, today)
  const lighter = readiness && lighterWeekFor(program, week, readiness, decisions, reEntry)
  const painful = readiness && painFor(week, readiness, decisions)
  return [...(reEntry ? [reEntry] : []), ...(lighter ? [lighter] : []), ...(painful ? [painful] : [])]
}

/** Readiness flags in a Week that make the rest of it a third lighter. */
export const READINESS_FLAGS = 3

/**
 * Three Readiness flags in a Week: the Coach suggests the rest of it a third
 * lighter, from the day of the third, like a re-entry. Never in a Deload week
 * or the Taper, and not on top of an accepted re-entry: the Week is lighter
 * already.
 */
function lighterWeekFor(
  program: Program,
  week: Week,
  { reports, nights = [], today }: ReadinessInput,
  decisions: SuggestionDecision[],
  reEntry: ReEntrySuggestion | null,
): LighterWeekSuggestion | null {
  if (week.deload || phaseOfWeek(program, week.number).id === 'taper' || reEntry?.decision === 'accepted') return null
  if (today < week.startDate) return null
  const sunday = addDays(week.startDate, 6)
  const flags = readinessFlags(reports, nights, week.startDate, today < sunday ? today : sunday).slice(0, READINESS_FLAGS)
  if (flags.length < READINESS_FLAGS) return null

  const id = lighterWeekId(week.number)
  const decided = decisionFor(decisions, id)
  return {
    id,
    kind: 'lighter-week',
    week: week.number,
    sessionId: null,
    date: flags.at(-1)!.date,
    from: { volumePercent: 100 },
    to: { volumePercent: RE_ENTRY_PERCENT },
    trigger: { flags },
    decision: decided?.decision ?? 'open',
    decidedOn: decided?.date ?? null,
  }
}

/**
 * The days from `from` to `to` that Readiness acted on, oldest first: a Pain
 * report the pain rules act on (3 or more, or higher than the one before), or
 * a night under 6 hours ending that morning. A day counts once.
 */
function readinessFlags(reports: PainReport[], nights: RecoveryNight[], from: LocalDate, to: LocalDate): ReadinessFlag[] {
  const ordered = inOrder(reports)
  const flags: ReadinessFlag[] = []
  for (let date = from; date <= to; date = addDays(date, 1)) {
    const scores = ordered.flatMap((r, i) =>
      r.date === date && painLevel(r.score, ordered[i - 1]?.score ?? null) ? [r.score] : [],
    )
    const night = nightOf(nights, date)
    const sleepMinutes = night && isShortSleep(night) ? night.sleepMinutes : null
    if (scores.length > 0 || sleepMinutes !== null) {
      flags.push({ date, painScore: scores.length > 0 ? Math.max(...scores) : null, sleepMinutes })
    }
  }
  return flags
}

/**
 * The pain rules, while a Pain report of 3 or more, or a rising one, stands:
 * an erg for burpee broad jumps and sled push and about 30% fewer interval
 * reps, or from 5 easy
 * low-impact work or rest. Only for the Week holding today, or a Session of
 * another Week done today.
 */
function painFor(
  week: Week,
  { reports, today, doneToday = false }: ReadinessInput,
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
 * sleep under 6 hours takes a rep, round or Station off (by Session
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

/**
 * The days an accepted re-entry or lighter-Week Suggestion made lighter, up
 * to `today`: from the day it applies from to the Monday after.
 */
function lighterSpans(
  program: Program,
  logs: SessionLog[],
  decisions: SuggestionDecision[],
  today: LocalDate,
  readiness: ReadinessInput,
): LighterSpan[] {
  const reEntries = returns(program, logs, today)
    .filter((r) => r.week !== null && reEntryFor(program, findWeek(program, r.week)!, logs, decisions, today)?.date === r.date)
    .filter((r) => decisionFor(decisions, reEntryId(r.week!))?.decision === 'accepted')
    .map((r) => r.date)
  const lighterWeeks = program.phases
    .flatMap((phase) => phase.weeks)
    .filter((week) => week.startDate <= today && decisionFor(decisions, lighterWeekId(week.number))?.decision === 'accepted')
    .flatMap((week) => {
      const reEntry = reEntryFor(program, week, logs, decisions, today)
      return lighterWeekFor(program, week, readiness, decisions, reEntry)?.date ?? []
    })
  return [...reEntries, ...lighterWeeks].sort().map((start) => ({ start, landsOn: addDays(mondayOf(start), 7) }))
}

const acceptedPain = (suggestions: Suggestion[]): PainLevel | null =>
  suggestions.find((s): s is PainSuggestion => s.kind === 'pain' && s.decision === 'accepted')?.level ?? null

/** Coming back to training after a gap of `RE_ENTRY_DAYS` or more. */
interface Return {
  /** The first day trained after the gap; today, while the athlete hasn't trained yet. */
  date: LocalDate
  /** The last day trained before it. */
  since: LocalDate
  /** The Week Up next came from on `date`: the oldest Late Week, or the Week holding it. Null outside the Program. */
  week: number | null
}

/** Every return to training by `today`, oldest first. Without `today`, only those a log has closed. */
function returns(program: Program, logs: SessionLog[], today: LocalDate | null): Return[] {
  const days = [...new Set(logs.filter(trained).map((l) => l.date))]
    .filter((d) => today === null || d <= today)
    .sort()
  if (today !== null && days.length > 0 && days.at(-1) !== today) days.push(today)
  return days.flatMap((date, i) =>
    i > 0 && daysBetween(days[i - 1], date) >= RE_ENTRY_DAYS
      ? [{ date, since: days[i - 1], week: weekOnReturn(program, logs, date) }]
      : [],
  )
}

/** The Week Up next comes from on `date`, from what was logged before it (ADR-0007). */
function weekOnReturn(program: Program, logs: SessionLog[], date: LocalDate): number | null {
  const position = positionOf(program, date)
  if (position.kind !== 'in-week') return null
  const loggedBefore = (week: number, sessionId: string) =>
    logs.some((l) => l.week === week && l.sessionId === sessionId && l.date < date)
  const late = program.phases
    .flatMap((phase) => phase.weeks)
    .find(
      (week) =>
        week.number < position.week &&
        week.sessions.some((s) => !s.optional && !s.date && !loggedBefore(week.number, s.id)),
    )
  return late?.number ?? position.week
}

/**
 * 7 or more days with no Done or Partial log: suggest the rest of the Week Up
 * next comes from on return a third lighter (ADR-0007). It stands for the
 * latest such return to this Week. Deload weeks are lighter already, and the
 * Taper follows the race-week rules, so neither gets one.
 */
function reEntryFor(
  program: Program,
  week: Week,
  logs: SessionLog[],
  decisions: SuggestionDecision[],
  today: LocalDate | null,
): ReEntrySuggestion | null {
  if (week.deload || phaseOfWeek(program, week.number).id === 'taper') return null
  const back = returns(program, logs, today).findLast((r) => r.week === week.number)
  if (!back) return null

  const id = reEntryId(week.number)
  const decided = decisionFor(decisions, id)
  return {
    id,
    kind: 're-entry',
    week: week.number,
    sessionId: null,
    date: back.date,
    from: { volumePercent: 100 },
    to: { volumePercent: RE_ENTRY_PERCENT },
    trigger: { lastSession: back.since, days: daysBetween(back.since, back.date) },
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
        case 'lighter-week':
          // The rest of the Week: a Session done before it applies stays as it was.
          return {
            ...adapted,
            sessions: adapted.sessions.map((session) => {
              const log = logFor(logs, adapted.number, session.id)
              return log && trained(log) && log.date < s.date ? session : lighten(session, s.to.volumePercent)
            }),
          }
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
 * applied. For screens that show a Week other than today's; with `readiness`,
 * the pain rules apply to the Week holding its `today`, and its flags can
 * lighten the Week.
 */
export function prescribedWeek(
  program: Program,
  number: number,
  logs: SessionLog[],
  decisions: SuggestionDecision[],
  equipment: readonly Equipment[] = DEFAULT_EQUIPMENT,
  readiness: ReadinessInput | null = null,
): Week | null {
  const listed = findWeek(program, number)
  const week = listed && offeredSessions(program, listed, logs)
  return week && adapt(week, suggestionsFor(program, week, logs, decisions, readiness, readiness?.today ?? null), logs, equipment)
}
