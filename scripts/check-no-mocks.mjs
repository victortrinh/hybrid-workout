#!/usr/bin/env node
/**
 * Mock mode never ships (ADR-0005). Fails when the build in dist/ holds any
 * of it: Mock Service Worker's script or library, sql.js or its WebAssembly,
 * the D1 adapter over it, or the scenarios.
 *
 *   node scripts/check-no-mocks.mjs           after `npm run build`: none of it may be there
 *   node scripts/check-no-mocks.mjs --expect  after `npm run build:mock`: all of it must be,
 *                                             so the check above is known to look for the right things
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'

const DIST = 'dist'
const expect = process.argv.includes('--expect')

/** What gives each part away: a file name, or text only it contains. */
const MARKERS = [
  { what: "Mock Service Worker's script", file: (name) => name === 'mockServiceWorker.js' },
  { what: 'Mock Service Worker', text: '[MSW]' },
  { what: "sql.js's WebAssembly", file: (name) => name.endsWith('.wasm') },
  { what: 'sql.js', text: 'sqlite3_prepare_v2' },
  { what: 'the D1 adapter', text: 'The mock D1 has no' },
  { what: 'the scenarios', text: 'compromised:mock-scenario' },
]

const files = walk(DIST)
if (files.length === 0) {
  console.error(`Nothing in ${DIST}/: build first.`)
  process.exit(1)
}

const found = MARKERS.map((marker) => ({
  ...marker,
  in: files.filter((path) => {
    const name = path.split('/').pop()
    if (marker.file) return marker.file(name)
    return /\.(m?js|html|css|json)$/.test(name) && readFileSync(path, 'utf8').includes(marker.text)
  }),
}))

const wrong = found.filter((marker) => (expect ? marker.in.length === 0 : marker.in.length > 0))
for (const marker of wrong) {
  console.error(
    expect
      ? `Missing from the mock build: ${marker.what}. Update MARKERS in scripts/check-no-mocks.mjs.`
      : `Mock code in the build: ${marker.what}, in ${marker.in.map((p) => relative('.', p)).join(', ')}`,
  )
}
if (wrong.length > 0) process.exit(1)
console.log(expect ? 'The mock build has every part of mock mode.' : `No mock code in ${DIST}/.`)

function walk(dir) {
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return []
  }
  return entries.flatMap((entry) => (entry.isDirectory() ? walk(join(dir, entry.name)) : [join(dir, entry.name)]))
}
