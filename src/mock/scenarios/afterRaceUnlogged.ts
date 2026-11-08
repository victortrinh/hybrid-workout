import { history } from './history'
import { nights, scenario } from './scenario'

const h = history()
for (let week = 1; week <= 23; week++) h.week(week, { optional: week % 2 === 0 })
h.log(24, 'shakeout', '2027-04-19').log(24, 'station-touch', '2027-04-20')

/**
 * Friday 23 April 2027, the day after Race day, with the race not logged:
 * Today asks for the finish time, one field, before the recap. Dark, to see
 * the ask on near-black.
 */
export default scenario({
  name: 'after-race-unlogged',
  summary: 'The day after Race day, race not logged: Today asks for the finish time',
  today: '2027-04-23',
  time: '09:00',
  server: {
    sessionLogs: h.logs,
    suggestionDecisions: h.decisions,
    recoveryNights: nights('2027-04-09', '2027-04-23'),
  },
  device: { settings: { theme: 'dark' } },
})
