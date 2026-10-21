import { describe, expect, it } from 'vitest'
import { localDate } from '../domain/calendar'
import { findWeek } from '../domain/coach'
import { currentSet, finish, logSet, startLifts } from '../domain/lifts'
import { advance, end, pause, resume, startRun } from '../domain/live'
import { trainingPaces, type RunContext } from '../domain/paces'
import { program } from '../domain/program/program'
import { cuesFor } from './lockScreenCues'

const T0 = Date.parse('2026-11-11T17:00:00Z')
const at = (seconds: number) => T0 + seconds * 1000
const RPE_ONLY: RunContext = { paces: null, unit: 'kmh', environment: 'indoor' }
const session = (week: number, id: string) => findWeek(program, week)!.sessions.find((s) => s.id === id)!
const run = (id: string) => startRun({ week: 3, session: session(3, id), date: localDate('2026-11-11'), environment: 'indoor' }, T0)
const seconds = (cues: { at: number }[]) => cues.map((c) => (c.at - T0) / 1000)

describe('cuesFor a run', () => {
  it('stops at the Ready screen: the warm-up’s end says what’s next and to tap Start', () => {
    const cues = cuesFor(run('threshold'), RPE_ONLY)
    expect(cues).toEqual([{ at: at(600), title: 'Rep 1 of 2 next', body: 'Open the app and tap Start.' }])
  })

  it('walks every timed Block from there to the end of the Session', () => {
    const started = resume(advance(run('threshold'), at(600)), at(610))
    const cues = cuesFor(started, RPE_ONLY)
    expect(seconds(cues)).toEqual([610 + 720, 610 + 840, 610 + 1560, 610 + 2100])
    expect(cues.map((c) => c.title)).toEqual([
      expect.stringMatching(/^Jog/),
      expect.stringMatching(/^Rep 2 of 2/),
      expect.stringMatching(/^Easy and cooldown/),
      'Session over',
    ])
    expect(cues[1].body).toBe('Last rep. Same speed. Same face.')
    expect(cues[3].body).toBe('Open the app to log it.')
  })

  it('puts the target on the title, as the hero figure reads it', () => {
    const started = resume(advance(run('threshold'), at(600)), at(600))
    const paces = trainingPaces(21 * 60)
    const [, rep] = cuesFor(started, { paces, unit: 'kmh', environment: 'indoor' })
    expect(rep.title).toMatch(/^Rep 2 of 2 · \d+\.\d km\/h$/)
    const outdoors = startRun({ week: 3, session: session(3, 'threshold'), date: localDate('2026-11-11'), environment: 'outdoor' }, T0)
    const [, outdoorRep] = cuesFor(resume(advance(outdoors, at(600)), at(600)), { paces, unit: 'kmh', environment: 'indoor' })
    expect(outdoorRep.title).toMatch(/^Rep 2 of 2 · \d:\d\d \/km$/)
  })

  it('counts time paused in the Block: the cues move later by it', () => {
    const started = resume(advance(run('threshold'), at(600)), at(600))
    const paused = resume(pause(started, at(700)), at(760))
    expect(seconds(cuesFor(paused, RPE_ONLY))[0]).toBe(600 + 720 + 60)
  })

  it('stops at a Block with no clock: drills to tick, a run to a distance', () => {
    expect(cuesFor(run('speed'), RPE_ONLY)).toEqual([{ at: at(420), title: 'Drills', body: 'Drills. Sharp, not tired.' }])
  })

  it('has none while paused, on the finish sheet, or once it’s over', () => {
    const r = run('threshold')
    expect(cuesFor(pause(r, at(30)), RPE_ONLY)).toEqual([])
    expect(cuesFor(end(r, at(30)), RPE_ONLY)).toEqual([])
    expect(cuesFor(advance(r, at(600)), RPE_ONLY)).toEqual([])
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
