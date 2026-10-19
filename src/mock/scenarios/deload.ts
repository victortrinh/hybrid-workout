import { localDate } from '../../domain/calendar'
import { findWeek } from '../../domain/coach'
import { DEFAULT_EQUIPMENT, equip } from '../../domain/equipment'
import { logSet, startLifts } from '../../domain/lifts'
import { program } from '../../domain/program/program'
import { strengthState } from '../../domain/weights'
import { history } from './history'
import { nights, scenario } from './scenario'

const TODAY = localDate('2026-12-09')
const MINUTE = 60_000

const h = history()
for (let week = 1; week <= 6; week++) h.week(week, { optional: week % 2 === 1 })
h.log(7, 'speed', '2026-12-07')

/**
 * Wednesday 9 December 2026, in Week 7, a Deload week: runs and lifts scaled
 * down by a third, and the Strength session's loads at 85–90% of each
 * Working weight. That Strength session was started 25 minutes ago and left
 * running, two squat sets in, to QA coming back to a Live session.
 */
export default scenario({
  name: 'deload',
  summary: 'Week 7, a Deload week: scaled runs and lifts, a Live session left running',
  today: TODAY,
  time: '18:20',
  server: {
    sessionLogs: h.logs,
    suggestionDecisions: h.decisions,
    recoveryNights: nights('2026-11-25', TODAY),
  },
  device: {
    live(now) {
      const session = findWeek(program, 7)!.sessions.find((s) => s.id === 'strength')!
      const { weights } = strengthState(program, h.logs, h.decisions, TODAY)
      const started = startLifts(
        { week: 7, session: equip(session, DEFAULT_EQUIPMENT), date: TODAY, weights },
        now - 25 * MINUTE,
      )
      return logSet(logSet(started, 0, 0, now - 15 * MINUTE), 0, 1, now - MINUTE)
    },
  },
})
