import { history } from './history'
import { nights, scenario } from './scenario'

const h = history()
for (const week of [1, 2, 3]) h.week(week, { optional: week !== 3 })
h.log(4, 'hyrox-a', '2026-11-30')
  .log(4, 'strength', '2026-12-01', 'partial', { notes: 'Gym closing, left the calf raises.' })
  .log(4, 'run', '2026-12-02', 'skipped')
  .log(4, 'easy', '2026-12-02', 'swapped', { minutes: 45, notes: 'Spin class with Sam instead.' })

/**
 * Thursday 3 December 2026, Week 4, the default scenario. Weeks 1 to 3
 * done; this Week has a Done, a Partial, a Skipped and a Swapped Session,
 * HYROX A and Strength on consecutive days, and the HYROX B Key session Up next.
 */
export default scenario({
  name: 'midweek-mixed',
  summary: 'Week 4: Done, Partial, Skipped and Swapped, Up next',
  today: '2026-12-03',
  time: '07:00',
  server: {
    sessionLogs: h.logs,
    suggestionDecisions: h.decisions,
    recoveryNights: nights('2026-11-19', '2026-12-03'),
  },
})
