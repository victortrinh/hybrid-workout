import { BASELINE_DECISIONS, BASELINE_HISTORY, toLog } from './seed'
import { scenario } from './scenario'
import type { SuggestionDecision } from '../../domain/suggestion'

/**
 * Friday 30 October 2026, Week 2, the day after the Strength session and two
 * after a 23:00 baseline 5K test: Training paces everywhere. October runs
 * Outdoors, as pace per km, but this Week's Threshold session is set to the
 * treadmill, and the treadmill speaks mph, so both kinds of target show.
 */
export default scenario({
  name: 'after-baseline',
  summary: 'Week 2 after a 23:00 5K test: Training paces, Indoor and Outdoor, mph',
  today: '2026-10-30',
  time: '07:15',
  server: {
    sessionLogs: BASELINE_HISTORY.map((seed) => toLog(seed, 'mock')),
    suggestionDecisions: BASELINE_DECISIONS as SuggestionDecision[],
  },
  device: {
    settings: { unit: 'mph' },
    environment: { '2/threshold': 'indoor' },
  },
})
