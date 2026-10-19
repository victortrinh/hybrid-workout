import { history } from './history'
import { scenario, workout } from './scenario'

const h = history()
for (let week = 1; week <= 9; week++) h.week(week)

/** Saturday's jog, which the athlete said was none of the Sessions. */
const DISMISSED = workout('2026-12-26', '15:00', 'Running', 25, { distanceKm: 4.2, indoor: false })

/**
 * Wednesday 30 December 2026, Week 10, nothing logged yet this Week but the
 * watch has sent two workouts that fit more than one Session: Monday's
 * treadmill run (Speed, Threshold or the Easy run?) and Tuesday's circuit
 * (Strength or HYROX?), so Today asks "Which Session was this?". Week 9's
 * workouts attached on their own; a Saturday jog was dismissed; Tuesday's
 * walk fits nothing and isn't asked about.
 */
export default scenario({
  name: 'activities-pending',
  summary: 'Week 10: Apple Watch workouts waiting for “Which Session was this?”',
  today: '2026-12-30',
  time: '12:10',
  server: {
    sessionLogs: h.logs,
    suggestionDecisions: h.decisions,
    activities: [
      workout('2026-12-21', '23:00', 'Running', 44, { distanceKm: 8.1, indoor: false }),
      workout('2026-12-23', '23:10', 'Traditional Strength Training', 58, { averageHeartRate: 118, maxHeartRate: 151 }),
      workout('2026-12-25', '16:00', 'Running', 47, { distanceKm: 9.6, indoor: false }),
      DISMISSED,
      workout('2026-12-27', '15:30', 'Functional Strength Training', 66, { averageHeartRate: 151, maxHeartRate: 178 }),
      workout('2026-12-28', '23:30', 'Running', 50, { indoor: true }),
      workout('2026-12-29', '22:45', 'Functional Strength Training', 55, { averageHeartRate: 146, maxHeartRate: 175 }),
      workout('2026-12-29', '17:00', 'Walking', 30, { averageHeartRate: 96, maxHeartRate: 110, indoor: false }),
    ],
    activityAnswers: [{ activityId: DISMISSED.start, week: null, sessionId: null, updatedAt: '2026-12-26T18:00:00.000Z' }],
  },
})
