/**
 * A D1-shaped database over sql.js, SQLite in WebAssembly (ADR-0005), so the
 * Worker's own Hono app runs in the browser unchanged. Only as much of D1 as
 * the Worker uses: `prepare`, `bind`, `first`, `all`, `run`, `raw` and
 * `batch`, with D1's rule that a batch is one transaction.
 */
import type { BindParams, Database, SqlValue } from 'sql.js'

export function d1(db: Database, onWrite: () => void = () => {}): D1Database {
  const database = {
    prepare: (query: string) => statement(db, query, [], onWrite),
    async batch<T = unknown>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]> {
      db.exec('begin')
      try {
        const results = statements.map((s) => execute<T>(db, s as unknown as MockStatement))
        db.exec('commit')
        if (results.some((r) => r.meta.changed_db)) onWrite()
        return results
      } catch (error) {
        db.exec('rollback')
        throw error
      }
    },
    async exec(query: string): Promise<D1ExecResult> {
      const started = performance.now()
      const count = db.exec(query).length
      onWrite()
      return { count, duration: performance.now() - started }
    },
    withSession: () => unsupported('withSession'),
    dump: () => unsupported('dump'),
  }
  return database as unknown as D1Database
}

interface MockStatement {
  query: string
  values: SqlValue[]
}

function statement(db: Database, query: string, values: SqlValue[], onWrite: () => void) {
  const self: MockStatement & Record<string, unknown> = {
    query,
    values,
    // D1 binds into a new statement, so one prepared statement serves a whole batch.
    bind: (...next: unknown[]) => statement(db, query, next.map(sqlValue), onWrite),
    async first(column?: string) {
      const row = execute<Record<string, unknown>>(db, self).results[0] ?? null
      if (row === null || column === undefined) return row
      if (!(column in row)) throw new Error(`D1_COLUMN_NOTFOUND: Column not found (${column})`)
      return row[column]
    },
    async all() {
      return written(execute(db, self), onWrite)
    },
    async run() {
      return written(execute(db, self), onWrite)
    },
    async raw(options?: { columnNames?: boolean }) {
      const [result] = db.exec(query, values as BindParams)
      const rows = result?.values ?? []
      return options?.columnNames ? [result?.columns ?? [], ...rows] : rows
    },
  }
  return self as unknown as D1PreparedStatement
}

function written<T>(result: D1Result<T>, onWrite: () => void): D1Result<T> {
  if (result.meta.changed_db) onWrite()
  return result
}

function execute<T>(db: Database, { query, values }: MockStatement): D1Result<T> {
  const started = performance.now()
  const prepared = db.prepare(query)
  const results: T[] = []
  try {
    prepared.bind(values)
    while (prepared.step()) results.push(prepared.getAsObject() as T)
  } finally {
    prepared.free()
  }
  const changes = db.getRowsModified()
  const changed = changes > 0 && !/^\s*select\b/i.test(query)
  const lastRowId = Number(db.exec('select last_insert_rowid()')[0]?.values[0]?.[0] ?? 0)
  return {
    success: true,
    results,
    meta: {
      duration: performance.now() - started,
      size_after: 0,
      rows_read: results.length,
      rows_written: changed ? changes : 0,
      last_row_id: lastRowId,
      changed_db: changed,
      changes: changed ? changes : 0,
    },
  }
}

/** D1 refuses `undefined`, and stores booleans as 1 and 0. */
function sqlValue(value: unknown): SqlValue {
  if (value === undefined) throw new Error('D1_TYPE_ERROR: Type "undefined" not supported')
  if (typeof value === 'boolean') return value ? 1 : 0
  if (value === null || typeof value === 'number' || typeof value === 'string' || value instanceof Uint8Array) {
    return value
  }
  if (value instanceof ArrayBuffer) return new Uint8Array(value)
  throw new Error(`D1_TYPE_ERROR: Type "${typeof value}" not supported`)
}

function unsupported(name: string): never {
  throw new Error(`The mock D1 has no ${name}(); the Worker doesn't use it`)
}
