import { history } from './history'
import { nights, scenario } from './scenario'

const h = history()
for (let week = 1; week <= 25; week++) h.week(week, { optional: week % 2 === 0 })
h.log(26, 'shakeout', '2027-04-19').log(26, 'race', '2027-04-21', 'done', {
  minutes: 84,
  rpe: 10,
  splitSeconds: 270,
  resultSeconds: 84 * 60 + 7,
})

/**
 * Thursday 22 April 2027, the day after Race day: all 26 Weeks trained and
 * the race logged with its finish time, with only the tail of Race week left
 * on the calendar. Today's result and Program recap; the Plan and Progress
 * past the end of the Program.
 */
export default scenario({
  name: 'after-race',
  summary: 'The day after Race day: the finish time and the Program recap',
  today: '2027-04-22',
  time: '10:00',
  server: {
    sessionLogs: h.logs,
    suggestionDecisions: h.decisions,
    recoveryNights: nights('2027-04-08', '2027-04-22'),
  },
})
