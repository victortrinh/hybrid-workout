import { history } from './history'
import { nights, scenario } from './scenario'

const TODAY = '2027-04-21'

const h = history()
for (let week = 1; week <= 26; week++) h.week(week, { optional: week % 2 === 0, skip: ['race-simulation'] })
h.log(27, 'shakeout', '2027-04-19')

/**
 * Wednesday 21 April 2027, Race day morning, with every Race simulation
 * Skipped: the race card with Race loads and no splits, saying why.
 */
export default scenario({
  name: 'race-morning',
  summary: 'Race day morning, no Race simulation ever logged',
  today: TODAY,
  time: '06:45',
  server: {
    sessionLogs: h.logs,
    suggestionDecisions: h.decisions,
    recoveryNights: nights('2027-04-07', TODAY),
  },
})
