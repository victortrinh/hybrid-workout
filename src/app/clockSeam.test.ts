import { describe, expect, it } from 'vitest'

/**
 * Every read of the current time goes through src/domain/clock.ts, so mock
 * mode can pin it. Token expiry in access.ts keeps real time on purpose.
 */
const sources = import.meta.glob<string>(
  ['../app/**/*.{ts,tsx}', '../worker/**/*.ts', '../cues/**/*.ts', '!**/*.test.{ts,tsx}', '!../worker/access.ts', '!../worker/worker-configuration.d.ts'],
  { query: '?raw', import: 'default', eager: true },
)

const READS_NOW = /new Date\(\s*\)|Date\.now\(\s*\)/

describe('the clock seam', () => {
  it('finds the sources it guards', () => {
    expect(Object.keys(sources)).toContain('../worker/index.ts')
    expect(Object.keys(sources)).toContain('./App.tsx')
  })

  it('is the only place that reads the current time', () => {
    const offenders = Object.entries(sources).flatMap(([path, text]) =>
      text
        .split('\n')
        .map((line, i) => ({ line, at: `${path}:${i + 1}` }))
        .filter(({ line }) => READS_NOW.test(line))
        .map(({ at }) => at),
    )
    expect(offenders, 'read now from nowMs() or nowDate() in src/domain/clock.ts').toEqual([])
  })
})
