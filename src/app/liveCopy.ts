/**
 * The Coach's lines in a Live session: each Block of a run, each set at the
 * rack. Blunt, short enough to read mid-stride (PRODUCT.md, Coach voice).
 */
import type { LiveLifts } from '../domain/lifts'
import type { LiveBlock, LiveRun } from '../domain/live'

export function liveLine(block: LiveBlock, run: LiveRun): string {
  if (run.pausedAt !== null) return run.environment === 'indoor' ? 'Paused. The belt isn’t. Step off it.' : 'Paused.'
  const last = block.rep !== null && !run.blocks.slice(run.block + 1).some((b) => b.rep !== null)
  switch (block.kind) {
    case 'warm-up':
      return 'Warm-up. Easy. Nobody is watching.'
    case 'drills':
      return /plyo/i.test(block.name)
        ? 'Quality contacts. Full reset between jumps.'
        : /accel/i.test(block.name)
          ? 'Fast, not maximal. Walk back.'
          : 'Drills. Sharp, not tired.'
    case 'rep': {
      if (block.effort && 'feel' in block.effort && block.effort.feel === 'controlled') {
        return `Rep ${block.rep}. Controlled. It’s a Deload week, remember.`
      }
      if (run.type === 'threshold') {
        if (block.rep === 1) return 'Rep 1. Threshold. Do not race it.'
        return last ? 'Last rep. Same speed. Same face.' : `Rep ${block.rep}. Same speed. Same face.`
      }
      return last ? 'Last rep. Hard, not desperate.' : `Rep ${block.rep}. Hard, not desperate.`
    }
    case 'recovery':
      return 'Jog. Breathe. Pretend this is easy.'
    case 'run':
      return 'Conversational. If you can’t talk, slow down.'
    case 'distance':
      if (run.type === 'race-simulation') {
        return block.round === 1 ? 'Run 1. Conservative. The race is long.' : `Run ${block.round}. RPE 8, not all-out.`
      }
      return run.environment === 'indoor'
        ? 'All-out, but even. Tap Finished when the console says 5.00.'
        : 'All-out, but even. Tap Finished when the watch says 5 km.'
    case 'round': {
      const last = !run.blocks.slice(run.block + 1).some((b) => b.kind === 'round')
      if (block.round === 1) return 'Run, then the Stations. Technique before speed.'
      return last ? 'Last round. Same technique, tired legs.' : `Round ${block.round}. Smooth beats fast.`
    }
    case 'station':
      return 'Race load. Smooth beats fast. Tap Finished when it’s done.'
    case 'cooldown':
      return 'Cooldown. You may now look tired.'
  }
}

/** The finish sheet's line: what the log will say. */
export const finishLine = (status: 'done' | 'partial') =>
  status === 'done' ? 'All of it. Now say how it felt.' : 'Cut short. It logs as Partial, which still counts.'

const WORDS = ['nothing', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine']

/** Reps in reserve ≈ 10 − RPE, in words: "three left", "three to five left", "nothing left". */
export function tankWords(rpeLow: number, rpeHigh: number = rpeLow): string {
  const most = Math.round(10 - Math.min(rpeLow, rpeHigh))
  const least = Math.round(10 - Math.max(rpeLow, rpeHigh))
  const word = (n: number) => WORDS[Math.max(0, Math.min(9, n))]
  if (most <= 0) return 'nothing left'
  if (least === most) return `${word(most)} left`
  return `${least === 0 ? 'none' : word(least)} to ${word(most)} left`
}

/** "RPE 5–7: three to five left in the tank": the target's own words. */
export function tankLine(rpeLow: number, rpeHigh: number = rpeLow): string {
  const rpe = rpeLow === rpeHigh ? `${rpeLow}` : `${Math.min(rpeLow, rpeHigh)}–${Math.max(rpeLow, rpeHigh)}`
  const words = tankWords(rpeLow, rpeHigh)
  return `RPE ${rpe}: ${words.endsWith('nothing left') ? words : `${words} in the tank`}`
}

/** The RPE or range an exercise's words name ("RPE 7–8", "ramp to RPE 7"), else its default RPE. */
function targetTank(exercise: LiveLifts['exercises'][number]): string {
  const m = exercise.calibrate ? null : /^RPE (\d+)(?:–(\d+))?$/.exec(exercise.rpeWords ?? '')
  return m ? tankLine(Number(m[1]), Number(m[2] ?? m[1])) : tankLine(exercise.rpe)
}

/** The Coach's opening line for a Live Strength session. */
export function liftsStartLine(lifts: LiveLifts): string {
  const first = lifts.exercises[0]
  if (!first) return 'Nothing to lift. Suspicious.'
  if (first.calibrate) return `Calibration. Ramp up. Stop when a set feels like ${targetTank(first)}.`
  if (first.rpeWords?.startsWith('RPE ≤')) return 'Deload. Lighter on purpose. Leave the ego in the car.'
  return `${first.name} first. ${targetTank(first)}.`
}

/** After a set is logged at its default RPE. */
export const loggedLine = (set: number, rpe: number) => `Set ${set} logged at RPE ${rpe}. Tap the RPE if that was a lie.`

/** After the athlete changes a set's RPE. */
export function rpeLine(rpe: number): string {
  if (rpe <= 7) return 'Three in the tank. Exactly as ordered.'
  if (rpe === 8) return 'Two left. Fine. Do not get greedy.'
  return `RPE ${rpe}. Same weight next time, hero.`
}

export const REST_OVER_LINE = 'Rest over. Under the bar.'
export const ALL_SETS_LINE = 'Every set in. Finish when you’re ready.'
