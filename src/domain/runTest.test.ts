import { describe, expect, it } from 'vitest'
import { findWeek } from './coach'
import { localDate } from './calendar'
import type { SessionLog } from './log'
import { runTestResult } from './paces'
import { program } from './program/program'
import { runTestLines, runTestRounds, runTestTimes } from './runTest'

const test = findWeek(program, 2)!.sessions.find((s) => s.id === 'compromised-run-test')!

describe('the Compromised run test logged after', () => {
  it('has four rounds of 1 km then a Station at half race volume', () => {
    expect(runTestRounds(test).map((r) => [r.round, r.runMeters, r.station, r.meters ?? r.reps])).toEqual([
      [1, 1000, 'skierg', 500],
      [2, 1000, 'sled-push', 25],
      [3, 1000, 'row', 500],
      [4, 1000, 'wall-balls', 50],
    ])
  })

  it('writes the Station logs a Live test writes, so its splits set Race run pace', () => {
    const rounds = runTestRounds(test)
    const stations = runTestLines(rounds, { runs: [290, 300, 305, 313], stations: [120, 90, 125, null] })
    expect(stations).toHaveLength(8)
    expect(stations[0]).toEqual({ round: 1, part: 'run', pounds: null, meters: 1000, reps: null, seconds: 290 })
    expect(stations[7]).toMatchObject({ round: 4, part: 'wall-balls', reps: 50, seconds: null })
    const log = {
      id: 'log-test-0001',
      week: 2,
      sessionId: 'compromised-run-test',
      date: localDate('2026-11-18'),
      status: 'done',
      stations,
    } as SessionLog
    expect(runTestResult(log)).toMatchObject({ raceRun: 302, fade: 23 })
    expect(runTestTimes(rounds, log)).toEqual({ runs: [290, 300, 305, 313], stations: [120, 90, 125, null] })
  })

  it('writes nothing when nothing was timed', () => {
    const rounds = runTestRounds(test)
    expect(runTestLines(rounds, runTestTimes(rounds, null))).toEqual([])
  })
})
