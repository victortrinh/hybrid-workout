import { BASELINE_DECISIONS, BASELINE_HISTORY, toLog } from './seed'
import { scenario } from './scenario'
import type { SuggestionDecision } from '../../domain/suggestion'

/**
 * Friday 20 November 2026, Week 2, the day after the Strength session and two
 * after the baseline Compromised run test, with the Starting point's estimate
 * giving Training paces everywhere. November runs on the treadmill, which
 * speaks mph, but this Week's Easy run is set Outdoors, as pace per km, so
 * both kinds of target show.
 */
export default scenario({
  name: 'after-baseline',
  summary: 'Week 2 after the baseline test: Training paces, Indoor and Outdoor, mph',
  today: '2026-11-20',
  time: '07:15',
  server: {
    sessionLogs: BASELINE_HISTORY.map((seed) => toLog(seed, 'mock')),
    suggestionDecisions: BASELINE_DECISIONS as SuggestionDecision[],
    startingPoint: { fiveKSeconds: 23 * 60, weights: {}, updatedAt: '2026-11-05T12:00:00.000Z' },
  },
  device: {
    settings: { unit: 'mph' },
    environment: { '2/easy': 'outdoor' },
  },
})
