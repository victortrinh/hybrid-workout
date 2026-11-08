import initSqlJs, { type SqlJsStatic } from 'sql.js'
import { beforeAll, describe, expect, it } from 'vitest'
import { EXPORT_TABLES } from '../worker/export'
import { d1 } from './d1'
import { migrations, openDatabase } from './database'

let SQL: SqlJsStatic
beforeAll(async () => {
  SQL = await initSqlJs()
})

describe('the mock database', () => {
  it('applies every migration, in order', () => {
    expect(migrations.map((m) => m.name)).toEqual([...migrations.map((m) => m.name)].sort())
    expect(migrations.length).toBeGreaterThanOrEqual(9)
    const db = openDatabase(SQL)
    const applied = db.exec('select name from d1_migrations order by id')[0].values.flat()
    expect(applied).toEqual(migrations.map((m) => m.name))
    const tables = db.exec("select name from sqlite_master where type = 'table'")[0].values.flat()
    for (const table of EXPORT_TABLES) expect(tables).toContain(table)
  })

  it('restored from a saved copy, keeps its rows and applies nothing twice', async () => {
    const first = openDatabase(SQL)
    await d1(first).prepare("insert into recovery_nights values ('2026-11-11', 420, 60, 50, 'Ring', 'x')").run()
    const again = openDatabase(SQL, first.export())
    expect(again.exec('select count(*) from d1_migrations')[0].values[0][0]).toBe(migrations.length)
    expect(again.exec('select sleep_minutes from recovery_nights')[0].values).toEqual([[420]])
  })
})

describe('migration 0013: Training paces from the Compromised run test', () => {
  it('upgrades a database saved before it: the old result and estimate columns go, the estimated split arrives, the rows stay', () => {
    const before = new SQL.Database()
    before.exec('create table d1_migrations (id integer primary key autoincrement, name text unique, applied_at text)')
    for (const { name, sql } of migrations.filter((m) => m.name < '0013')) {
      before.exec(sql)
      before.run("insert into d1_migrations (name, applied_at) values (?, 'x')", [name])
    }
    before.exec(`insert into session_logs (id, week, session_id, date, status, minutes, rpe, notes, result_seconds, environment, updated_at)
      values ('log-test-0001', 2, 'compromised-run-test', '2026-11-18', 'done', 45, 9, null, 1380, 'indoor', 'x')`)
    // Positional: the old estimate column is second, before the two lifts.
    before.exec("insert into starting_point values (1, 1380, 225, null, 'x')")
    const after = openDatabase(SQL, before.export())
    const columns = (table: string) => after.exec(`pragma table_info(${table})`)[0].values.map((row) => row[1])
    expect(columns('session_logs')).not.toContain('result_seconds')
    expect(columns('session_logs')).toContain('finish_seconds')
    expect(columns('starting_point')).toEqual(['id', 'back_squat_pounds', 'romanian_deadlift_pounds', 'updated_at', 'split_seconds'])
    expect(after.exec('select id, environment from session_logs')[0].values).toEqual([['log-test-0001', 'indoor']])
    expect(after.exec('select split_seconds, back_squat_pounds from starting_point')[0].values).toEqual([[null, 225]])
    expect(() => after.exec("update starting_point set split_seconds = 60")).toThrow(/CHECK/)
  })
})

describe('d1', () => {
  const open = (onWrite?: () => void) => d1(openDatabase(SQL), onWrite)

  it('binds positional and numbered parameters into a new statement each time', async () => {
    const db = open()
    const insert = db.prepare(
      "insert into suggestion_decisions (id, decision, date, updated_at) values (?1, ?2, '2026-11-11', ?3)",
    )
    await insert.bind('a', 'accepted', 't1').run()
    await insert.bind('b', 'kept', 't2').run()
    const { results } = await db.prepare('select id, decision from suggestion_decisions order by id').all()
    expect(results).toEqual([
      { id: 'a', decision: 'accepted' },
      { id: 'b', decision: 'kept' },
    ])
  })

  it('answers first() with a row, a column, or null', async () => {
    const db = open()
    expect(await db.prepare('select 1 as ok, 2 as two').first()).toEqual({ ok: 1, two: 2 })
    expect(await db.prepare('select 1 as ok').first('ok')).toBe(1)
    expect(await db.prepare('select * from recovery_nights').first()).toBeNull()
  })

  it('reports changes from run() and stays quiet about reads', async () => {
    let writes = 0
    const db = open(() => writes++)
    const { meta } = await db
      .prepare("insert into recovery_nights values (?, ?, null, null, 'Ring', 'x')")
      .bind('2026-11-11', 420)
      .run()
    expect(meta.changes).toBe(1)
    expect(meta.changed_db).toBe(true)
    expect(writes).toBe(1)
    const read = await db.prepare('select * from recovery_nights').all()
    expect(read.meta.changed_db).toBe(false)
    expect(writes).toBe(1)
  })

  it('runs a batch as one transaction: a failure leaves nothing behind', async () => {
    const db = open()
    const insert = db.prepare("insert into recovery_nights values (?, 420, null, null, 'Ring', 'x')")
    await expect(db.batch([insert.bind('2026-11-11'), insert.bind('2026-11-11')])).rejects.toThrow(/UNIQUE/)
    expect(await db.prepare('select count(*) as n from recovery_nights').first('n')).toBe(0)
    const results = await db.batch([insert.bind('2026-11-11'), db.prepare('select date from recovery_nights')])
    expect(results[1].results).toEqual([{ date: '2026-11-11' }])
  })

  it("refuses undefined, as D1 does, and stores booleans as 1 and 0", async () => {
    const db = open()
    expect(() => db.prepare('select ?').bind(undefined)).toThrow(/undefined/)
    expect(await db.prepare('select ? as yes').bind(true).first('yes')).toBe(1)
  })
})
