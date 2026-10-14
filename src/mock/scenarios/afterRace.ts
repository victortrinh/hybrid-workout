import { history } from './history'
import { nights, scenario } from './scenario'

const h = history()
for (let week = 1; week <= 26; week++) h.week(week, { optional: week % 2 === 0 })
h.log(27, 'shakeout', '2027-04-19').log(27, 'race', '2027-04-21', 'done', { minutes: 84, rpe: 10, splitSeconds: 270 })

/**
 * Thursday 22 April 2027, the day after Race day: all 27 Weeks trained and
 * the race logged, with only the tail of Race week left on the calendar.
 * Everything past the end of the Program: Today, the Plan, Progress.
 */
export default scenario({
  name: 'after-race',
  summary: 'The day after Race day: past the end of the Program',
  today: '2027-04-22',
  time: '10:00',
  server: {
    sessionLogs: h.logs,
    suggestionDecisions: h.decisions,
    recoveryNights: nights('2027-04-08', '2027-04-22'),
  },
})
