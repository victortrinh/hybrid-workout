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
          : /stride/i.test(block.name)
            ? 'Quick and relaxed. Not a sprint.'
            : /lunge/i.test(block.name)
              ? 'Lunges. Wake the legs up, don’t tire them.'
              : 'Drills. Sharp, not tired.'
    case 'rep': {
      if (block.effort && 'feel' in block.effort && block.effort.feel === 'controlled') {
        return `Rep ${block.rep}. Controlled. It’s a Deload week, remember.`
      }
      if (block.effort && 'pace' in block.effort && block.effort.pace === 'threshold') {
        if (block.rep === 1) return 'Rep 1. Threshold. Do not race it.'
        return last ? 'Last rep. Same speed. Same face.' : `Rep ${block.rep}. Same speed. Same face.`
      }
      return last ? 'Last rep. Hard, not desperate.' : `Rep ${block.rep}. Hard, not desperate.`
    }
    case 'recovery':
      return 'Jog or walk. Breathe. Pretend this is easy.'
    case 'run':
      return 'Conversational. If you can’t talk, slow down.'
    case 'distance':
      if (run.type === 'race-simulation') {
        return block.round === 1 ? 'Run 1. Conservative. The race is long.' : `Run ${block.round}. RPE 8, not all-out.`
      }
      if (run.type === 'compromised-run-test') {
        return block.round === 1 ? 'Run 1. Full effort, but even. The Station is waiting.' : `Run ${block.round}. Full effort on tired legs. That’s the test.`
      }
      return run.environment === 'indoor'
        ? 'Even effort. Tap Finished when the console says the distance.'
        : 'Even effort. Tap Finished when the watch says the distance.'
    case 'round': {
      const last = !run.blocks.slice(run.block + 1).some((b) => b.kind === 'round')
      if (block.round === 1) return 'Tap Finished at the end of every leg. Technique before speed.'
      return last ? 'Last round. Same technique, tired legs.' : `Round ${block.round}. Smooth beats fast.`
    }
    case 'station':
      return 'Race load. Smooth beats fast. Tap Finished when it’s done.'
    case 'setup':
      return 'Load every Station now. This clock isn’t training. Tap Done when it’s all set.'
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
/** After Undo on a set logged by mistake. */
export const unloggedLine = (set: number) => `Set ${set} taken back. Fix it, then log it for real.`

/** After the athlete changes a set's RPE. */
export function rpeLine(rpe: number): string {
  if (rpe <= 7) return 'Three in the tank. Exactly as ordered.'
  if (rpe === 8) return 'Two left. Fine. Do not get greedy.'
  return `RPE ${rpe}. Same weight next time, hero.`
}

export const REST_OVER_LINE = 'Rest over. Under the bar.'
/** A checklist's rest over: the next jump set or acceleration. */
export const SET_REST_OVER_LINE = 'Rest over. Next set.'
export const ALL_SETS_LINE = 'Every set in. Finish when you’re ready.'

/** "2 s under", "6 s over", "on target": a Station's time against its Station target. */
export const underOver = (delta: number) => (delta === 0 ? 'on target' : `${Math.abs(delta)} s ${delta < 0 ? 'under' : 'over'}`)

/** The Station just finished against its Station target, said once on the next Ready screen. */
export function verdictLine(name: string, time: string, delta: number): string {
  if (delta < 0) return `${name} in ${time}, ${-delta} s under the Station target. Keep that.`
  if (delta > 0) return `${name} in ${time}, ${delta} s over the Station target. Smoother, not harder.`
  return `${name} in ${time}: the Station target, to the second.`
}

/** "4 of 6 Stations under their Station target.": the finish sheet's count. */
export function tallyLine(beat: number, judged: number): string {
  if (judged === 1) return beat === 1 ? 'The one Station target: beaten.' : 'The one Station target: not today.'
  return `${beat} of ${judged} Stations at or under their Station target.`
}

const COUNT = ['None', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine']
const count = (n: number) => COUNT[n] ?? `${n}`

/** The Coach on a Run session's reps against their target pace, under the finish sheet's count. */
export function repsLine(held: number, targeted: number): string {
  if (held === targeted) return targeted === 1 ? 'On target. Dull. Exactly right.' : `All ${targeted} on target. Dull. Exactly right.`
  if (held === 0) return targeted === 1 ? 'Off target. Start it slower next time.' : `None of ${targeted} on target. Start the first one slower.`
  return `${count(targeted - held)} off target. The first rep sets the rest.`
}
