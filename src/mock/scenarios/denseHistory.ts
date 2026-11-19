import { EQUIPMENT } from '../../domain/equipment'
import { history } from './history'
import { scenario } from './scenario'

const TODAY = '2027-03-04'
const FULL_GYM = [...EQUIPMENT]

const h = history(FULL_GYM)
for (let week = 1; week <= 16; week++) {
  h.week(week, {
    optional: week % 2 === 0,
    partial: week === 6 ? ['run'] : week === 14 ? ['strength'] : [],
    skip: week === 11 ? ['hyrox-a'] : [],
  })
}
h.log(17, 'hyrox-a', '2027-03-01').log(17, 'strength', '2027-03-03')
  .pain('2027-01-13', 2, 'knee')
  .pain('2027-01-15', 0, null)
  .pain('2027-02-03', 1, 'shin')
  .pain('2027-02-05', 0, null)

/**
 * Thursday 4 March 2027, Week 17: sixteen Weeks logged with a few Partial
 * and Skipped Sessions, three Compromised run tests, a Race simulation, every Working
 * weight's climb. For Progress, Training load and the export with real data.
 * A gym with every machine, so no Substitutions.
 */
export default scenario({
  name: 'dense-history',
  summary: 'Week 17, nearly everything logged: Progress, Training load, export',
  today: TODAY,
  time: '20:30',
  server: {
    sessionLogs: h.logs,
    suggestionDecisions: h.decisions,
    painReports: h.painReports,
  },
  device: { settings: { equipment: FULL_GYM } },
})
