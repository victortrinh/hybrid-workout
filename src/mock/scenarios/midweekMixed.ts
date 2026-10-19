import { history } from './history'
import { nights, scenario } from './scenario'

const h = history()
for (const week of [1, 2, 3]) h.week(week, { optional: week !== 3 })
h.log(4, 'speed', '2026-11-16')
  .log(4, 'strength', '2026-11-17', 'partial', { notes: 'Gym closing, left the calf raises.' })
  .log(4, 'hyrox', '2026-11-18', 'skipped')
  .log(4, 'easy', '2026-11-18', 'swapped', { minutes: 45, notes: 'Spin class with Sam instead.' })

/**
 * Thursday 19 November 2026, Week 4, the default scenario. Weeks 1 to 3
 * done; this Week has a Done, a Partial, a Skipped and a Swapped Session,
 * Speed and Strength on consecutive days, and the Threshold Key session Up next.
 */
export default scenario({
  name: 'midweek-mixed',
  summary: 'Week 4: Done, Partial, Skipped and Swapped, Up next',
  today: '2026-11-19',
  time: '07:00',
  server: {
    sessionLogs: h.logs,
    suggestionDecisions: h.decisions,
    recoveryNights: nights('2026-11-05', '2026-11-19'),
  },
})
