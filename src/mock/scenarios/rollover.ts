import { history } from './history'
import { nights, scenario } from './scenario'

const h = history()
for (const week of [1, 2, 3, 4]) h.week(week)
h.log(5, 'speed', '2026-11-16')
  // Squats all at RPE 7: the Working weight Suggestion stays open, since Week 6's Strength was Skipped.
  .log(5, 'strength', '2026-11-18', 'done', { undecided: true })
  .log(5, 'threshold', '2026-11-20')
  // Late: Week 5's HYROX session, made up on Monday of Week 6.
  .log(5, 'hyrox', '2026-11-23')
  .log(6, 'speed', '2026-11-24')
  .log(6, 'strength', '2026-11-25', 'skipped')
  .log(6, 'hyrox', '2026-11-28', 'skipped')
  // Early: Week 7's Easy run, on the Sunday before it.
  .log(7, 'easy', '2026-11-29')

/**
 * Monday 30 November 2026, the first day of Week 7, after a Week 6 with two
 * Sessions Skipped and its Threshold Key session never done, so carried until
 * Wednesday. Two Suggestions wait: a lighter re-entry Week, and Week 5's
 * squat going up. Week 5's HYROX was done late, Week 7's Easy run early.
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
