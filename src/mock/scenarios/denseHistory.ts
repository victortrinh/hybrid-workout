import { EQUIPMENT } from '../../domain/equipment'
import { history } from './history'
import { nights, scenario, workout } from './scenario'

const TODAY = '2027-03-04'
const FULL_GYM = [...EQUIPMENT]

const h = history(FULL_GYM)
for (let week = 1; week <= 19; week++) {
  h.week(week, {
    optional: week % 2 === 0,
    partial: week === 6 ? ['threshold'] : week === 14 ? ['strength'] : [],
    skip: week === 11 ? ['hyrox'] : [],
  })
}
h.log(20, 'speed', '2027-03-01').log(20, 'strength', '2027-03-03')
  .pain('2027-01-13', 2, 'knee')
  .pain('2027-01-15', 0, null)
  .pain('2027-02-03', 1, 'shin')
  .pain('2027-02-05', 0, null)

/**
 * Thursday 4 March 2027, Week 20: nineteen Weeks logged with a few Partial
 * and Skipped Sessions, three 5K tests, two Race simulations, every Working
 * weight's climb, three months of nights from the ring and a fortnight of
 * watch workouts. For Progress, Training load and the export with real data.
 * A gym with every machine, so no Substitutions.
 */
export default scenario({
  name: 'dense-history',
  summary: 'Week 20, nearly everything logged: Progress, Training load, export',
  today: TODAY,
  time: '20:30',
  server: {
    sessionLogs: h.logs,
    suggestionDecisions: h.decisions,
    painReports: h.painReports,
    recoveryNights: nights('2026-12-01', TODAY, (night, i) => (i % 17 === 9 ? null : night)),
    activities: [
      workout('2027-02-22', '23:00', 'Running', 50, { distanceKm: 9.4, indoor: false }),
      workout('2027-02-24', '23:00', 'Traditional Strength Training', 62),
      workout('2027-02-26', '23:00', 'Running', 55, { distanceKm: 11.2, indoor: false }),
      workout('2027-02-28', '16:00', 'Functional Strength Training', 70),
      workout('2027-03-01', '23:00', 'Running', 48, { indoor: true }),
      workout('2027-03-03', '23:00', 'Traditional Strength Training', 60),
    ],
  },
  device: { settings: { equipment: FULL_GYM } },
})
