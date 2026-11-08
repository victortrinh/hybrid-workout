import { scenario } from './scenario'

/**
 * Wednesday 4 November 2026, five days before Week 1, with nothing logged:
 * every empty state, the countdown to the start, and tapping a Week 1 Session
 * on Today to do it early.
 */
export default scenario({
  name: 'before-program',
  summary: 'Before Week 1: empty states, starting a Session early',
  today: '2026-11-04',
})
