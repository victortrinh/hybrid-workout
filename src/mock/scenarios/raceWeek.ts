import { history } from './history'
import { nights, scenario } from './scenario'

const TODAY = '2027-04-21'

const h = history()
for (let week = 1; week <= 23; week++) h.week(week, { optional: week % 2 === 0 })
h.log(24, 'shakeout', '2027-04-19').log(24, 'station-touch', '2027-04-20')

/**
 * Wednesday 21 April 2027, Race week, the day before Race day: the Taper done,
 * Monday's shakeout and Tuesday's Station touch logged, and only the race
 * left, pinned to tomorrow. For
 * the countdown and the race-week rules.
 */
export default scenario({
  name: 'race-week',
  summary: 'Week 24, the day before Race day: Taper done, the countdown',
  today: TODAY,
  time: '07:30',
  server: {
    sessionLogs: h.logs,
    suggestionDecisions: h.decisions,
    recoveryNights: nights('2027-04-07', TODAY),
  },
  device: { settings: { theme: 'dark' } },
})
