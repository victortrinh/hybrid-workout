import { describe, expect, it } from 'vitest'
import { localDate } from '../domain/calendar'
import { findWeek } from '../domain/coach'
import { currentSet, finish, logSet, startLifts } from '../domain/lifts'
import { advance, end, nextBlock, pause, resume, startRun, tick } from '../domain/live'
import { trainingPaces, type RunContext } from '../domain/paces'
import { program } from '../domain/program/program'
import type { Session } from '../domain/program/types'
import { cuesFor } from './lockScreenCues'

const T0 = Date.parse('2026-11-11T17:00:00Z')
const at = (seconds: number) => T0 + seconds * 1000
const RPE_ONLY: RunContext = { paces: null, unit: 'kmh', environment: 'indoor' }
const session = (week: number, id: string) => findWeek(program, week)!.sessions.find((s) => s.id === id)!
const run = (id: string) => startRun({ week: 3, session: session(3, id), date: localDate('2026-11-11'), environment: 'indoor' }, T0)
const seconds = (cues: { at: number }[]) => cues.map((c) => (c.at - T0) / 1000)

describe('cuesFor a run', () => {
  it('stops at the Ready screen: the warm-up’s end says what’s next and to tap Start', () => {
    const cues = cuesFor(run('run'), RPE_ONLY)
    expect(cues).toEqual([{ at: at(600), title: 'Rep 1 of 3 next', body: 'Open the app and tap Start.' }])
  })

  it('walks every timed Block from there to the end of the Session', () => {
    const started = resume(advance(run('run'), at(600)), at(610))
    const cues = cuesFor(started, RPE_ONLY)
    expect(seconds(cues)).toEqual([610 + 480, 610 + 570, 610 + 1050, 610 + 1140, 610 + 1620, 610 + 2100])
    expect(cues.map((c) => c.title)).toEqual([
      expect.stringMatching(/^Jog/),
      expect.stringMatching(/^Rep 2 of 3/),
      expect.stringMatching(/^Jog/),
      expect.stringMatching(/^Rep 3 of 3/),
      expect.stringMatching(/^Cooldown/),
      'Session over',
    ])
    expect(cues[3].body).toBe('Last rep. Same speed. Same face.')
    expect(cues[5].body).toBe('Open the app to log it.')
  })

  it('puts the target on the title in the screen’s wording: both units indoors, pace per km outdoors', () => {
    const started = resume(advance(run('run'), at(600)), at(600))
    const paces = trainingPaces(282)
    const [, rep] = cuesFor(started, { paces, unit: 'kmh', environment: 'indoor' })
    expect(rep.title).toMatch(/^Rep 2 of 3 · \d+\.\d km\/h · \d:\d\d\/km · 1% incline$/)
    const outdoors = startRun({ week: 3, session: session(3, 'run'), date: localDate('2026-11-11'), environment: 'outdoor' }, T0)
    const [, outdoorRep] = cuesFor(resume(advance(outdoors, at(600)), at(600)), { paces, unit: 'kmh', environment: 'indoor' })
    expect(outdoorRep.title).toMatch(/^Rep 2 of 3 · \d:\d\d\/km$/)
  })

  it('counts time paused in the Block: the cues move later by it', () => {
    const started = resume(advance(run('run'), at(600)), at(600))
    const paused = resume(pause(started, at(700)), at(760))
    expect(seconds(cuesFor(paused, RPE_ONLY))[0]).toBe(600 + 480 + 60)
  })

  it('stops at a Block with no clock: strides to tick, a run to a distance', () => {
    const test = startRun({ week: 2, session: session(2, 'compromised-run-test'), date: localDate('2026-11-18'), environment: 'indoor' }, T0)
    expect(cuesFor(test, RPE_ONLY)).toEqual([{ at: at(480), title: 'Strides', body: 'Quick and relaxed. Not a sprint.' }])
    const onStrides = nextBlock(advance(test, at(480)), at(600))
    expect(onStrides.blocks[onStrides.block].kind).toBe('distance')
    expect(cuesFor(onStrides, RPE_ONLY)).toEqual([])
  })

  it('has none while paused, on the finish sheet, or once it’s over', () => {
    const r = run('run')
    expect(cuesFor(pause(r, at(30)), RPE_ONLY)).toEqual([])
    expect(cuesFor(end(r, at(30)), RPE_ONLY)).toEqual([])
    expect(cuesFor(advance(r, at(600)), RPE_ONLY)).toEqual([])
  })
})

describe('cuesFor a checklist rest', () => {
  /** No Session in the Program rests between ticked sets any more; a drill Block with rests stands in. */
  const drills: Session = {
    id: 'run',
    type: 'run',
    headline: 'drills',
    minutes: 20,
    key: false,
    optional: false,
    blocks: [
      { name: 'Warm-up', minutes: 7, exercises: [{ name: 'Easy jog', prescription: { kind: 'run', minutes: 7, effort: { pace: 'easy' } } }] },
      {
        name: 'Plyometrics',
        minutes: 5,
        exercises: [
          { name: 'Pogo jumps', prescription: { kind: 'sets', sets: 2, reps: 15, load: { kind: 'bodyweight' }, restSeconds: [60, 60] } },
          { name: 'Broad jumps', prescription: { kind: 'sets', sets: 3, reps: 3, load: { kind: 'bodyweight' }, restSeconds: [20, 20] } },
        ],
      },
      { name: 'Easy run', minutes: 8, main: true, exercises: [{ name: 'Easy run', prescription: { kind: 'run', minutes: 8, effort: { pace: 'easy' } } }] },
    ],
  }
  /** On Plyometrics at 600 s: the jog ran its 7 minutes, then Start. */
  const plyometrics = () =>
    resume(advance(startRun({ week: 3, session: drills, date: localDate('2026-11-11'), environment: 'indoor' }, T0), at(420)), at(600))

  it('is the end of the rest, naming the set it’s for', () => {
    const resting = tick(plyometrics(), 0, at(630))
    expect(cuesFor(resting, RPE_ONLY)).toEqual([
      { at: at(690), title: 'Pogo jumps 15 · set 2 of 2', body: 'Rest over. Next set.' },
    ])
    const broad = tick(tick(resting, 1, at(640)), 2, at(700))
    expect(cuesFor(broad, RPE_ONLY)).toEqual([
      { at: at(720), title: 'Broad jumps 3 · set 2 of 3', body: 'Rest over. Next set.' },
    ])
  })

  it('is gone once the rest is cleared: an untick, Done or End', () => {
    const resting = tick(plyometrics(), 0, at(630))
    expect(cuesFor(tick(resting, 0, at(631)), RPE_ONLY)).toEqual([])
    expect(cuesFor(end(resting, at(631)), RPE_ONLY)).toEqual([])
    expect(cuesFor(nextBlock(resting, at(631)), RPE_ONLY)).toEqual([])
  })
})

describe('cuesFor Strength', () => {
  const lifts = () => startLifts({ week: 3, session: session(3, 'strength'), date: localDate('2026-11-11'), weights: {} }, T0)

  it('is the end of the rest, naming the set it’s for', () => {
    const start = lifts()
    const first = currentSet(start)!
    const resting = logSet(start, first.exercise, first.set, at(100))
    const [cue] = cuesFor(resting, RPE_ONLY)
    expect(cue.at).toBe(at(100) + resting.rest!.seconds * 1000)
    expect(cue.title).toBe(`${resting.exercises[0].name} · set 2 of ${resting.sets[0].length}`)
    expect(cue.body).toBe('Rest over. Under the bar.')
  })

  it('has none with nobody resting, or on the finish sheet', () => {
    const start = lifts()
    expect(cuesFor(start, RPE_ONLY)).toEqual([])
    expect(cuesFor(finish(logSet(start, 0, 0, at(100))), RPE_ONLY)).toEqual([])
  })
})
