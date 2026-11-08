import { history } from './history'
import { nights, scenario } from './scenario'

const TODAY = '2027-02-25'

const h = history()
for (let week = 1; week <= 15; week++) h.week(week, { optional: week % 3 === 0 })
h.log(16, 'run', '2027-02-22')
  .pain('2027-02-22', 2, 'achilles-calf', { week: 16, sessionId: 'run' })
  .log(16, 'strength', '2027-02-23')
  .log(16, 'easy', '2027-02-24')
  .pain('2027-02-24', 3, 'achilles-calf')

/**
 * Thursday 25 February 2027, Week 16, the first Week of Race specific.
 * Working weights found and progressed since Week 1, fifteen Weeks of Station
 * logs behind, and the half Race simulation, the Key session, still to do at
 * Race loads. The left Achilles went from 2 to 3 yesterday, so the pain rules
 * stand; last night was 5 h 20 with HRV well under its mean, so Readiness is
 * low and the Coach suggests an easy day.
 */
export default scenario({
  name: 'race-specific',
  summary: 'Week 16: Working weights, Station logs, pain and low Readiness',
  today: TODAY,
  time: '06:40',
  server: {
    sessionLogs: h.logs,
    suggestionDecisions: h.decisions,
    painReports: h.painReports,
    recoveryNights: nights('2027-02-11', TODAY, (night) =>
      night.date === TODAY ? { ...night, sleepMinutes: 320, hrvMs: 41, restingHeartRate: 57 } : night,
    ),
  },
  device: { settings: { theme: 'dark' } },
})
