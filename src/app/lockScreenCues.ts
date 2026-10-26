/**
 * Lock-screen cues (ADR-0006): what the Live session's clock will say next,
 * and when, for the server to send as push notifications while the app is
 * off screen. The page works the list out the moment it's hidden, from the
 * same `advance` the clock runs on; the server only keeps time.
 */
import type { Cue } from '../domain/cues'
import { currentSet, isLifts, type LiveLifts, type LiveSession } from '../domain/lifts'
import { advance, isOver, liveTarget, type LiveRun } from '../domain/live'
import type { RunContext } from '../domain/paces'
import { liveLine, REST_OVER_LINE, SET_REST_OVER_LINE } from './liveCopy'

/**
 * Every cue from now until the clock next waits on a tap: each timed Block's
 * end, up to the Ready screen, a Block run to a distance or a checklist, or
 * the end of the Session; or, between a checklist's sets, the end of the
 * rest. Strength has one: the end of the rest.
 */
export function cuesFor(live: LiveSession, runContext: RunContext): Cue[] {
  return isLifts(live) ? restCue(live) : runCues(live, { ...runContext, environment: live.environment })
}

function runCues(run: LiveRun, context: RunContext): Cue[] {
  if (isOver(run)) return []
  // A checklist Block has no clock to run down: only its rest ends on its own.
  if (run.rest) return [checklistRestCue(run, run.rest)]
  if (run.pausedAt !== null) return []
  const cues: Cue[] = []
  let next = run
  while (next.block < next.blocks.length && next.pausedAt === null) {
    const seconds = next.blocks[next.block].seconds
    if (seconds === null) break
    const at = next.blockStartedAt + next.blockPausedMs + seconds * 1000
    next = advance(next, at)
    cues.push({ at, ...cueText(next, context) })
  }
  return cues
}

/** What the lock screen says as the clock moves onto `run`'s current Block. */
function cueText(run: LiveRun, context: RunContext): Pick<Cue, 'title' | 'body'> {
  const block = run.blocks[run.block]
  if (!block) return { title: 'Session over', body: 'Open the app to log it.' }
  if (run.ready) return { title: `${block.name} next`, body: 'Open the app and tap Start.' }
  const target = liveTarget(block, context)
  const figure = target && (target.unit === 'RPE' ? `RPE ${target.value}` : `${target.value} ${target.unit}`)
  return { title: figure ? `${block.name} · ${figure}` : block.name, body: liveLine(block, run) }
}

function checklistRestCue(run: LiveRun, rest: NonNullable<LiveRun['rest']>): Cue {
  const block = run.blocks[run.block]
  const next = block.checklist.find((_, i) => i > rest.row && !run.ticked.includes(i)) ??
    block.checklist.find((_, i) => !run.ticked.includes(i))
  return { at: rest.startedAt + rest.seconds * 1000, title: next ?? 'Rest over', body: SET_REST_OVER_LINE }
}

function restCue(lifts: LiveLifts): Cue[] {
  if (!lifts.rest || lifts.ending) return []
  const next = currentSet(lifts)
  const exercise = next && lifts.exercises[next.exercise]
  return [
    {
      at: lifts.rest.startedAt + lifts.rest.seconds * 1000,
      title: exercise ? `${exercise.name} · set ${next.set + 1} of ${lifts.sets[next.exercise].length}` : 'Rest over',
      body: REST_OVER_LINE,
    },
  ]
}
