import { scenario } from './scenario'

/**
 * Thursday 22 October 2026, the app opened for the first time: no Starting
 * point yet, so the Starting point screen comes first. Skipping both sections
 * gives the before-program state with RPE-only runs.
 */
export default scenario({
  name: 'first-launch',
  summary: 'First launch: the Starting point screen, nothing given yet',
  today: '2026-10-22',
  server: { startingPoint: null },
})
