/**
 * Every scenario mock mode can load (ADR-0005), by `?scenario=` name, in the
 * order the Program reaches them.
 */
import activitiesPending from './activitiesPending'
import afterBaseline from './afterBaseline'
import afterRace from './afterRace'
import beforeProgram from './beforeProgram'
import deload from './deload'
import denseHistory from './denseHistory'
import estimates from './estimates'
import firstLaunch from './firstLaunch'
import hyroxBuild from './hyroxBuild'
import midweekMixed from './midweekMixed'
import raceMorning from './raceMorning'
import raceWeek from './raceWeek'
import rollover from './rollover'
import type { Scenario } from './scenario'
import week1Start from './week1Start'

export type { Scenario } from './scenario'

export const SCENARIOS: readonly Scenario[] = [
  beforeProgram,
  firstLaunch,
  week1Start,
  estimates,
  afterBaseline,
  midweekMixed,
  rollover,
  deload,
  activitiesPending,
  hyroxBuild,
  denseHistory,
  raceWeek,
  raceMorning,
  afterRace,
]

/** What mock mode loads when no scenario is chosen. */
export const DEFAULT_SCENARIO = 'midweek-mixed'

export const findScenario = (name: string): Scenario | null => SCENARIOS.find((s) => s.name === name) ?? null
