/**
 * The Coach's line for each Block of a Live run session. Blunt, short enough
 * to read mid-stride (PRODUCT.md, Coach voice).
 */
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
