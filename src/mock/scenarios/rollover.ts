import { history } from './history'
import { nights, scenario } from './scenario'

const h = history()
for (const week of [1, 2, 3]) h.week(week)
h.log(4, 'speed', '2026-11-16')
  // Squats all at RPE 7: the Working weight Suggestion stays open, since Week 5's Strength was Skipped.
  .log(4, 'strength', '2026-11-18', 'done', { undecided: true })
  .log(4, 'threshold', '2026-11-20')
  // Late: Week 4's HYROX session, made up on Monday of Week 5.
  .log(4, 'hyrox', '2026-11-23')
  .log(5, 'speed', '2026-11-24')
  .log(5, 'strength', '2026-11-25', 'skipped')
  .log(5, 'hyrox', '2026-11-28', 'skipped')
  // Early: Week 6's Easy run, on the Sunday before it.
  .log(6, 'easy', '2026-11-29')

/**
 * Monday 30 November 2026, the first day of Week 6, after a Week 5 with two
 * Sessions Skipped and its Threshold Key session never done, so carried until
 * Wednesday. Two Suggestions wait: a lighter re-entry Week, and Week 4's
 * squat going up. Week 4's HYROX was done late, Week 6's Easy run early.
 */
export default scenario({
  name: 'rollover',
  summary: 'Monday after misses: a carried Key session, pending Suggestions',
  today: '2026-11-30',
  time: '06:45',
  server: {
    sessionLogs: h.logs,
    suggestionDecisions: h.decisions,
    recoveryNights: nights('2026-11-16', '2026-11-30'),
  },
})
