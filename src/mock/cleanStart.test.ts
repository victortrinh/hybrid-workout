import { describe, expect, it } from 'vitest'
import deploy from '../../docs/deploy.md?raw'
import { EXPORT_TABLES } from '../worker/export'

/** The clean start in docs/deploy.md: the commands Victor runs to wipe production stay in step with the schema. */
describe('the clean start in docs/deploy.md', () => {
  const wipe = deploy.match(/execute compromised --remote --command "(delete from [^"]+)"/)?.[1] ?? ''

  it('empties every exported table, children before parents, and nothing else', () => {
    const deleted = [...wipe.matchAll(/delete from (\w+);/g)].map((m) => m[1])
    expect([...deleted].sort()).toEqual([...EXPORT_TABLES].sort())
    const children = ['interval_logs', 'station_logs', 'set_logs'].map((t) => deleted.indexOf(t))
    expect(deleted.indexOf('session_logs')).toBeGreaterThan(Math.max(...children))
    expect(deleted.indexOf('activities')).toBeGreaterThan(deleted.indexOf('activity_answers'))
  })

  it('counts every exported table afterwards', () => {
    for (const table of EXPORT_TABLES) expect(deploy).toContain(`count(*) from ${table}`)
  })
})
