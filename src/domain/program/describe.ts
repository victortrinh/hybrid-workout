/**
 * Plain-language lines for a Session, read from its relative Prescription.
 *
 * Given a RunContext with Training paces, runs read as exact treadmill speeds
 * or paces per km; without one (before the baseline 5K test) they read as
 * effort and RPE. Lifts read as sets and reps until there are Working weights.
 */
import { runTarget, type RunContext } from '../paces'
import type {
  Block,
  Exercise,
  Lane,
  Prescription,
  RunEffort,
  Session,
  SessionType,
  Station,
  StationId,
  StrengthLoad,
  Substitution,
  SubstitutionReason,
} from './types'

export const SESSION_TYPES: Record<SessionType, { name: string; lane: Lane }> = {
  speed: { name: 'Speed', lane: 'speed' },
  strength: { name: 'Strength', lane: 'strength' },
  threshold: { name: 'Threshold', lane: 'threshold' },
  hyrox: { name: 'HYROX', lane: 'hyrox' },
  easy: { name: 'Easy run', lane: 'easy' },
  '5k-test': { name: '5K test', lane: 'speed' },
  'race-simulation': { name: 'Race simulation', lane: 'hyrox' },
}

export interface SessionDescription {
  /** "Threshold, 3 × 7′" */
  heading: string
  /** One line for a Bucket row: "3 × 7′ at Threshold / 2′ jog" */
  summary: string
  /** The target line under the heading on Today. */
  target: string
  /** "45 min · Key session this Week" */
  meta: string
}

export function describeSession(session: Session, run?: RunContext): SessionDescription {
  const main = session.blocks.filter((b) => b.main)
  return {
    heading: `${SESSION_TYPES[session.type].name}, ${session.headline}`,
    summary: summary(session, main),
    target: target(session, main, run),
    meta: [
      `${session.minutes} min`,
      session.key && 'Key session this Week',
      session.optional && 'Optional',
    ]
      .filter(Boolean)
      .join(' · '),
  }
}

function summary(session: Session, main: Block[]): string {
  const rx = firstPrescription(main)
  switch (rx?.kind) {
    case 'intervals':
      return `${rx.reps} × ${duration(rx.workSeconds)} ${effortWord(rx.effort)} / ${duration(rx.recoverySeconds)} ${rx.recovery}`
    case 'run': {
      if (isCircuit(main)) return `${main.length} × (${runLength(main)} + ${stationsPerRound(main)})`
      const runs = main[0].exercises.filter((e) => e.prescription.kind === 'run').length
      if (runs > 1) return `${runs} × (${km(rx.meters ?? 0)} + Station)`
      const effort = rx.effort ? ` ${effortWord(rx.effort)}` : ''
      return rx.meters ? `${km(rx.meters)}${effort}` : `${rx.minutes} min${effort}`
    }
    case 'sets': {
      const calibration = calibrationRpe(session)
      return calibration ? `Ramp each lift to RPE ${calibration}` : mainLifts(main)
    }
    default:
      return session.headline
  }
}

function target(session: Session, main: Block[], run?: RunContext): string {
  const rx = firstPrescription(main)
  switch (rx?.kind) {
    case 'intervals': {
      const accelerations = findPrescription(session, 'accelerations')
      return [
        effortTarget(rx.effort, run),
        `${duration(rx.recoverySeconds)} ${rx.recovery}`,
        accelerations && `${accelerations.reps} accelerations first`,
      ]
        .filter(Boolean)
        .join(' · ')
    }
    case 'run': {
      if (isCircuit(main)) {
        const percent = main.flatMap((b) => b.exercises).map(raceLoadPercent).find((p) => p !== undefined)
        return [
          `${runLength(main)} run + ${stationsPerRound(main)} a round`,
          percent && `about ${percent}% of Race load`,
        ]
          .filter(Boolean)
          .join(' · ')
      }
      if (rx.meters) {
        const strides = findPrescription(session, 'strides')
        return [`${km(rx.meters)} ${effortTarget(rx.effort, run)}`, strides && `${strides.reps} strides first`]
          .filter(Boolean)
          .join(' · ')
      }
      return rx.effort ? effortTarget(rx.effort, run) : `${rx.minutes} min`
    }
    case 'sets': {
      const calibration = calibrationRpe(session)
      if (calibration) return `Ramp each lift to RPE ${calibration} to find its Working weight`
      return [mainLifts(main), rx.rpe && `RPE ${range(rx.rpe)}`, rx.rpeCap && `RPE ≤ ${rx.rpeCap}`, loadWords(rx.load)]
        .filter(Boolean)
        .join(' · ')
    }
    case 'note':
      // Done by instruction, like the easy bike the pain rules swap in.
      return main[0].exercises[0].note ?? ''
    default:
      return ''
  }
}

const firstPrescription = (blocks: Block[]): Prescription | undefined => blocks[0]?.exercises[0]?.prescription

function findPrescription<K extends Prescription['kind']>(session: Session, kind: K) {
  for (const block of session.blocks) {
    for (const exercise of block.exercises) {
      if (exercise.prescription.kind === kind) return exercise.prescription as Extract<Prescription, { kind: K }>
    }
  }
  return undefined
}

/** The RPE a calibration Session ramps each lift to, or undefined for a normal Session. */
function calibrationRpe(session: Session): number | undefined {
  for (const block of session.blocks) {
    for (const { prescription: rx } of block.exercises) {
      if (rx.kind === 'sets' && rx.load.kind === 'find-working-weight') return rx.load.rpe
    }
  }
  return undefined
}

const SHORT_LIFT: Record<string, string> = { 'Back squat': 'Squat', 'Romanian deadlift': 'RDL' }

function mainLifts(main: Block[]): string {
  return main
    .flatMap((b) => b.exercises)
    .map((e) => (e.prescription.kind === 'sets' ? `${SHORT_LIFT[e.name] ?? e.name} ${e.prescription.sets} × ${e.prescription.reps}` : e.name))
    .join(', ')
}

/** HYROX rounds are the one Session with several main Blocks: a run, then Stations, each round. */
const isCircuit = (main: Block[]) => main.length > 1

function runLength(rounds: Block[]): string {
  const run = rounds[0].exercises[0].prescription
  return run.kind === 'run' && run.meters ? km(run.meters) : 'run'
}

/** "2 Stations", "1 Station", or "2–3 Stations" when rounds differ. */
function stationsPerRound(rounds: Block[]): string {
  const counts = rounds.map((r) => r.exercises.filter((e) => e.prescription.kind === 'station').length)
  const low = Math.min(...counts)
  const high = Math.max(...counts)
  return `${range([low, high])} ${high === 1 ? 'Station' : 'Stations'}`
}

const raceLoadPercent = (e: Exercise) =>
  e.prescription.kind === 'station' ? e.prescription.raceLoadPercent : undefined

function effortWord(effort: RunEffort): string {
  if ('feel' in effort) return effort.feel
  const pace = effort.pace === '5k' ? 'at 5K pace' : effort.pace === 'threshold' ? 'at Threshold' : effort.pace
  return effort.secondsPerKmFaster ? `${pace} −${effort.secondsPerKmFaster} s/km` : pace
}

/** With Training paces, the exact speed or pace and the RPE; without, the effort and RPE. */
function effortTarget(effort: RunEffort | undefined, run?: RunContext): string {
  if (!effort) return ''
  const rpe = effort.rpe ? `RPE ${range(effort.rpe)}` : ''
  const exact = run && runTarget(effort, run)
  if (exact) return [exact, rpe].filter(Boolean).join(' · ')
  if ('feel' in effort) {
    const feel = {
      easy: 'Easy',
      hard: 'Hard, by feel',
      controlled: 'Controlled',
      relaxed: 'Relaxed',
      'all-out': 'all-out',
    }[effort.feel]
    return [feel, rpe].filter(Boolean).join(', ')
  }
  const pace = { easy: 'Easy', threshold: 'Threshold effort', '5k': '5K effort', goal: 'Goal effort' }[effort.pace]
  const faster = effort.secondsPerKmFaster ? ` −${effort.secondsPerKmFaster} s/km` : ''
  return [`${pace}${faster}`, rpe].filter(Boolean).join(', ')
}

const range = ([low, high]: readonly [number, number]) => (low === high ? `${low}` : `${low}–${high}`)

/** 120 → 2′, 90 → 90″, 15 → 15″ */
function duration(seconds: number): string {
  return seconds % 60 === 0 ? `${seconds / 60}′` : `${seconds}″`
}

const km = (meters: number) => (meters % 1000 === 0 ? `${meters / 1000} km` : `${meters} m`)

/** How a lift's load reads before there is a Working weight to resolve it against. */
function loadWords(load: StrengthLoad): string {
  switch (load.kind) {
    case 'working-weight':
      return ''
    case 'percent-of-working-weight':
      return `${range(load.percent)}% of Working weight`
    case 'light':
      return 'light'
    case 'find-working-weight':
      return `ramp to RPE ${load.rpe}`
    case 'bodyweight':
      return 'bodyweight'
  }
}

/** Pounds rounded to the nearest 5 lb, the smallest step in the gym. */
export const roundToFive = (pounds: number) => Math.round(pounds / 5) * 5

/**
 * "200 lb", "2 × 30 lb", "13 lb ball", or nothing for a Station without a load.
 * A share of Race load rounds to the nearest 5 lb; Race load itself is exact.
 */
export function stationLoad(station: Station, percent = 100): string {
  const { pounds, implements: count, fixedLoad } = station.raceLoad
  if (pounds === undefined) return ''
  if (fixedLoad) return `${pounds} lb ball`
  const each = percent === 100 ? pounds : roundToFive((pounds * percent) / 100)
  return count && count > 1 ? `${count} × ${each} lb` : `${each} lb`
}

const SUBSTITUTION_REASON: Record<SubstitutionReason, string> = {
  'no-floor-space': 'no floor space',
  readiness: 'Readiness says no jumps',
}

export interface ExerciseLine {
  name: string
  /** "3 × 5 · RPE 7 · 90–120″ rest" */
  detail: string
  note?: string
  /** "No floor space or Readiness says no jumps: Sled push sprints 10–15 m, light, or Bike sprints 8–10″" */
  substitutions: string[]
}

/** One Exercise as it reads in a Week's Session list, with Race loads in pounds. */
export function describeExercise(
  exercise: Exercise,
  stations: Record<StationId, Station>,
  run?: RunContext,
): ExerciseLine {
  return {
    name: exercise.name,
    detail: prescriptionWords(exercise.prescription, stations, run),
    note: exercise.note,
    substitutions: (exercise.substitutions ?? []).map((s) => substitutionWords(s, stations)),
  }
}

function substitutionWords(substitution: Substitution, stations: Record<StationId, Station>): string {
  const when = substitution.when.map((w) => SUBSTITUTION_REASON[w]).join(' or ')
  const options = substitution.options
    .map((o) => [o.name, prescriptionWords(o.prescription, stations)].filter(Boolean).join(' '))
    .join(', or ')
  return `${when[0].toUpperCase()}${when.slice(1)}: ${options}`
}

function prescriptionWords(rx: Prescription, stations: Record<StationId, Station>, run?: RunContext): string {
  switch (rx.kind) {
    case 'run': {
      const amount = rx.meters ? km(rx.meters) : rx.minutes ? `${rx.minutes} min` : ''
      return [amount, rx.effort && effortTarget(rx.effort, run)].filter(Boolean).join(' · ')
    }
    case 'intervals':
      return [
        `${rx.reps} × ${duration(rx.workSeconds)} / ${duration(rx.recoverySeconds)} ${rx.recovery}`,
        effortTarget(rx.effort, run),
      ].join(' · ')
    case 'strides':
      return `${rx.reps} × ${duration(rx.seconds)}`
    case 'accelerations':
      return `${rx.reps} × ${rx.meters} m · ${range(rx.percentOfMax)}% of max`
    case 'sets': {
      const reps = typeof rx.reps === 'number' ? `${rx.reps}` : range(rx.reps)
      return [
        `${rx.sets} × ${reps}${rx.perLeg ? ' / leg' : ''}`,
        loadWords(rx.load),
        rx.rpe && `RPE ${range(rx.rpe)}`,
        rx.rpeCap && `RPE ≤ ${rx.rpeCap}`,
        rx.restSeconds && `${range(rx.restSeconds)}″ rest`,
      ]
        .filter(Boolean)
        .join(' · ')
    }
    case 'station': {
      const station = stations[rx.station]
      const volume = rx.meters ? km(rx.meters) : rx.reps ? `${rx.reps} reps` : ''
      const percent = rx.raceLoadPercent ?? 100
      const load = stationLoad(station, percent)
      const share = rx.raceLoadPercent !== undefined && rx.raceLoadPercent < 100 ? `${rx.raceLoadPercent}% of Race load` : ''
      return [volume, load, share].filter(Boolean).join(' · ')
    }
    case 'sprints':
      return [rx.meters && `${range(rx.meters)} m`, rx.seconds && `${range(rx.seconds)}″`, rx.light && 'light']
        .filter(Boolean)
        .join(', ')
    case 'note':
      return rx.minutes ? `${rx.minutes} min` : ''
  }
}
