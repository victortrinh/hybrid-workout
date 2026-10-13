/**
 * Plain-language lines for a Session, read from its relative Prescription.
 *
 * There are no Training paces or Working weights yet, so runs read as effort
 * and RPE and lifts as sets and reps. Exact speeds and pounds replace these
 * lines once the Coach can resolve them.
 */
import type { Block, Exercise, Lane, Prescription, RunEffort, Session, SessionType } from './types'

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

export function describeSession(session: Session): SessionDescription {
  const main = session.blocks.filter((b) => b.main)
  return {
    heading: `${SESSION_TYPES[session.type].name}, ${session.headline}`,
    summary: summary(session, main),
    target: target(session, main),
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
      if (isCircuit(main)) return `${main.length} × (${runLength(main)} + ${stationsPerRound(main)} Stations)`
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

function target(session: Session, main: Block[]): string {
  const rx = firstPrescription(main)
  switch (rx?.kind) {
    case 'intervals': {
      const accelerations = findPrescription(session, 'accelerations')
      return [
        effortTarget(rx.effort),
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
          `${runLength(main)} run + ${stationsPerRound(main)} Stations a round`,
          percent && `about ${percent}% of Race load`,
        ]
          .filter(Boolean)
          .join(' · ')
      }
      if (rx.meters) {
        const strides = findPrescription(session, 'strides')
        return [`${km(rx.meters)} ${effortTarget(rx.effort)}`, strides && `${strides.reps} strides first`]
          .filter(Boolean)
          .join(' · ')
      }
      return rx.effort ? effortTarget(rx.effort) : `${rx.minutes} min`
    }
    case 'sets': {
      const calibration = calibrationRpe(session)
      if (calibration) return `Ramp each lift to RPE ${calibration} to find its Working weight`
      return [mainLifts(main), rx.rpe && `RPE ${range(rx.rpe)}`].filter(Boolean).join(' · ')
    }
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

const stationsPerRound = (rounds: Block[]) =>
  rounds[0].exercises.filter((e) => e.prescription.kind === 'station').length

const raceLoadPercent = (e: Exercise) =>
  e.prescription.kind === 'station' ? e.prescription.raceLoadPercent : undefined

function effortWord(effort: RunEffort): string {
  if ('feel' in effort) return effort.feel
  return effort.pace === '5k' ? 'at 5K pace' : effort.pace === 'threshold' ? 'at Threshold' : effort.pace
}

/** Without Training paces, a pace reference reads as its effort and RPE. */
function effortTarget(effort: RunEffort | undefined): string {
  if (!effort) return ''
  const rpe = effort.rpe ? `RPE ${range(effort.rpe)}` : ''
  if ('feel' in effort) {
    const feel = { easy: 'Easy', hard: 'Hard, by feel', relaxed: 'Relaxed', 'all-out': 'all-out' }[effort.feel]
    return [feel, rpe].filter(Boolean).join(', ')
  }
  const pace = { easy: 'Easy', threshold: 'Threshold effort', '5k': '5K effort', goal: 'Goal effort' }[effort.pace]
  return [pace, rpe].filter(Boolean).join(', ')
}

const range = ([low, high]: readonly [number, number]) => (low === high ? `${low}` : `${low}–${high}`)

/** 120 → 2′, 90 → 90″, 15 → 15″ */
function duration(seconds: number): string {
  return seconds % 60 === 0 ? `${seconds / 60}′` : `${seconds}″`
}

const km = (meters: number) => (meters % 1000 === 0 ? `${meters / 1000} km` : `${meters} m`)
