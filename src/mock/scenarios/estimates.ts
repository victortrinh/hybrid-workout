import { scenario } from './scenario'

/**
 * Monday 19 October 2026, day one of Week 1, with a Starting point filled in:
 * a 21:00 estimated 5K gives estimated Training paces until the Week 2 test,
 * and the 225 lb squat and 185 lb RDL estimates start Week 1's calibration at
 * 155 lb and 125 lb. Settings still lets them be edited.
 */
export default scenario({
  name: 'estimates',
  summary: 'Day one with a Starting point: estimated paces, calibration from the estimates',
  today: '2026-10-19',
  time: '06:30',
  server: {
    startingPoint: {
      fiveKSeconds: 21 * 60,
      weights: { 'back-squat': 225, 'romanian-deadlift': 185 },
      updatedAt: '2026-10-15T12:00:00.000Z',
    },
  },
})
