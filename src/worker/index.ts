/**
 * The Worker: the JSON API under /api, with the built app served as static
 * assets beside it (see `assets` in wrangler.jsonc). Cloudflare Access sits in
 * front of the whole site (ADR-0001), so no route here handles sign-in.
 */
import { Hono } from 'hono'
import { findWeek } from '../domain/coach'
import { parseSessionLog, type SessionLog, type SyncState } from '../domain/log'
import { program } from '../domain/program/program'

const app = new Hono<{ Bindings: Env }>().basePath('/api')

/** More than a whole Program's worth of Sessions; anything bigger is a mistake. */
const MAX_BATCH = 500

/** Liveness, including a round trip to D1, so a broken binding fails loudly. */
app.get('/health', async (c) => {
  const row = await c.env.DB.prepare('select 1 as ok').first<{ ok: number }>()
  return c.json({ ok: true, db: row?.ok === 1 })
})

/** Everything stored, for a fresh device or after a sync. */
app.get('/state', async (c) => c.json(await readState(c.env.DB)))

/**
 * Upserts a batch of records written on a device, then answers with the
 * server's current state. A log the server already holds is replaced only by
 * a later edit, so replaying a batch is harmless.
 */
app.post('/sync', async (c) => {
  let logs: SessionLog[]
  try {
    logs = parseSyncRequest(await c.req.json())
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : 'Invalid request' }, 400)
  }

  if (logs.length > 0) {
    const upsert = c.env.DB.prepare(
      `insert into session_logs (id, week, session_id, date, status, minutes, rpe, notes, updated_at)
       values (?, ?, ?, ?, ?, ?, ?, ?, ?)
       on conflict (id) do update set
         week = excluded.week, session_id = excluded.session_id, date = excluded.date,
         status = excluded.status, minutes = excluded.minutes, rpe = excluded.rpe,
         notes = excluded.notes, updated_at = excluded.updated_at
       where excluded.updated_at > session_logs.updated_at`,
    )
    await c.env.DB.batch(
      logs.map((l) => upsert.bind(l.id, l.week, l.sessionId, l.date, l.status, l.minutes, l.rpe, l.notes, l.updatedAt)),
    )
  }
  return c.json(await readState(c.env.DB))
})

app.notFound((c) => c.json({ error: 'Not found' }, 404))

function parseSyncRequest(body: unknown): SessionLog[] {
  const raw = (body as { sessionLogs?: unknown } | null)?.sessionLogs
  if (!Array.isArray(raw)) throw new Error('sessionLogs must be an array')
  if (raw.length > MAX_BATCH) throw new Error(`At most ${MAX_BATCH} logs per sync`)
  return raw.map((value, i) => {
    try {
      const log = parseSessionLog(value)
      if (!findWeek(program, log.week)?.sessions.some((s) => s.id === log.sessionId)) {
        throw new Error(`Week ${log.week} has no Session "${log.sessionId}"`)
      }
      return log
    } catch (error) {
      throw new Error(`sessionLogs[${i}]: ${error instanceof Error ? error.message : 'invalid'}`)
    }
  })
}

interface SessionLogRow {
  id: string
  week: number
  session_id: string
  date: string
  status: string
  minutes: number | null
  rpe: number | null
  notes: string | null
  updated_at: string
}

async function readState(db: D1Database): Promise<SyncState> {
  const { results } = await db
    .prepare('select * from session_logs order by date, updated_at')
    .all<SessionLogRow>()
  return {
    sessionLogs: results.map((row) =>
      parseSessionLog({
        id: row.id,
        week: row.week,
        sessionId: row.session_id,
        date: row.date,
        status: row.status,
        minutes: row.minutes,
        rpe: row.rpe,
        notes: row.notes,
        updatedAt: row.updated_at,
      }),
    ),
  }
}

export default app
