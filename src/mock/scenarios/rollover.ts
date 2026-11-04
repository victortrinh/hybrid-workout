import { history } from './history'
import { nights, scenario } from './scenario'

const h = history()
for (const week of [1, 2, 3]) h.week(week)
h.log(4, 'speed', '2026-11-16')
  // Squats all at RPE 7: the Working weight Suggestion stays open, since Week 5's Strength was Skipped.
  .log(4, 'strength', '2026-11-18', 'done', { undecided: true })
  .log(4, 'threshold', '2026-11-20')
  // Early: Week 5's Speed session, on the Sunday before it.
  .log(5, 'speed', '2026-11-22')
  // Late: Week 4's HYROX session, made up on Monday of Week 5, the last training for a week.
  .log(4, 'hyrox', '2026-11-23')
  .log(5, 'strength', '2026-11-25', 'skipped')
  .log(5, 'hyrox', '2026-11-28', 'skipped')

/**
 * Monday 30 November 2026, the first day of Week 6, after a Week 5 with two
 * Sessions Skipped and its Threshold Key session never done, so Late: Up next
 * until it's done, one Session behind. Nothing trained for 7 days, so two
 * Suggestions wait: the rest of Week 5 a lighter re-entry, and Week 4's squat
 * going up. Week 4's HYROX was done late, Week 5's Speed early.
 */
export default scenario({
  name: 'rollover',
  summary: 'Monday after a week off: a Late Key session, pending Suggestions',
  today: '2026-11-30',
  time: '06:45',
  server: {
    sessionLogs: h.logs,
    suggestionDecisions: h.decisions,
    recoveryNights: nights('2026-11-16', '2026-11-30'),
  },
})
