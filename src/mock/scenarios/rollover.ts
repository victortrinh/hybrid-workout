import { history } from './history'
import { nights, scenario } from './scenario'

const h = history()
for (const week of [1, 2, 3, 4, 5]) h.week(week)
h.log(6, 'hyrox-a', '2026-12-14')
  // Squats all at RPE 7: the Working weight Suggestion stays open, since Week 7's Strength was Skipped.
  .log(6, 'strength', '2026-12-16', 'done', { undecided: true })
  .log(6, 'run', '2026-12-18')
  // Early: Week 7's HYROX A, on the Sunday before it.
  .log(7, 'hyrox-a', '2026-12-20')
  // Late: Week 6's HYROX B, made up on Monday of Week 7, the last training for a week.
  .log(6, 'hyrox-b', '2026-12-21')
  .log(7, 'strength', '2026-12-23', 'skipped')
  .log(7, 'run', '2026-12-26', 'skipped')

/**
 * Monday 28 December 2026, the first day of Week 8, after a Week 7 with two
 * Sessions Skipped and its HYROX B Key session never done, so Late: Up next
 * until it's done, one Session behind. Nothing trained for 7 days, so two
 * Suggestions wait: the rest of Week 7 a lighter re-entry, and Week 6's squat
 * going up. Week 6's HYROX B was done late, Week 7's HYROX A early.
 */
export default scenario({
  name: 'rollover',
  summary: 'Monday after a week off: a Late Key session, pending Suggestions',
  today: '2026-12-28',
  time: '06:45',
  server: {
    sessionLogs: h.logs,
    suggestionDecisions: h.decisions,
    recoveryNights: nights('2026-12-14', '2026-12-28'),
  },
})
