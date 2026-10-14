/**
 * The mock database: every `migrations/*.sql`, in order, on a sql.js
 * database, the way `wrangler d1 migrations apply` builds D1. A database
 * restored from an earlier visit gets only the migrations it hasn't had.
 */
import type { Database, SqlJsStatic } from 'sql.js'

const MIGRATIONS = import.meta.glob<string>('../../migrations/*.sql', { query: '?raw', import: 'default', eager: true })

/** Each migration's file name and SQL, in the order Wrangler applies them. */
export const migrations = Object.entries(MIGRATIONS)
  .map(([path, sql]) => ({ name: path.split('/').pop()!, sql }))
  .sort((a, b) => a.name.localeCompare(b.name))

export function openDatabase(SQL: SqlJsStatic, saved?: Uint8Array): Database {
  const db = saved ? new SQL.Database(saved) : new SQL.Database()
  // Wrangler's own bookkeeping table, so a restored database knows what it has.
  db.exec('create table if not exists d1_migrations (id integer primary key autoincrement, name text unique, applied_at text)')
  const applied = new Set(db.exec('select name from d1_migrations')[0]?.values.map(([name]) => String(name)) ?? [])
  for (const { name, sql } of migrations) {
    if (applied.has(name)) continue
    db.exec('begin')
    try {
      db.exec(sql)
      db.run("insert into d1_migrations (name, applied_at) values (?, datetime('now'))", [name])
      db.exec('commit')
    } catch (error) {
      db.exec('rollback')
      throw new Error(`Migration ${name} failed: ${error instanceof Error ? error.message : error}`)
    }
  }
  return db
}
