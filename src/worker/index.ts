/**
 * The Worker: the JSON API under /api, with the built app served as static
 * assets beside it (see `assets` in wrangler.jsonc). Cloudflare Access sits in
 * front of the whole site (ADR-0001), so no route here handles sign-in.
 */
import { Hono } from 'hono'
import { findWeek } from '../domain/coach'
import { parseSessionLog, type SessionLog, type SyncState } from '../domain/log'
import { program } from '../domain/program/program'
import { parseDecision, type SuggestionDecision } from '../domain/suggestion'

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
 * server's current state. A record the server already holds is replaced only
 * by a later edit, so replaying a batch is harmless.
 */
app.post('/sync', async (c) => {
  let logs: SessionLog[]
  let decisions: SuggestionDecision[]
  try {
    ;({ logs, decisions } = parseSyncRequest(await c.req.json()))
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : 'Invalid request' }, 400)
  }

  if (logs.length > 0) {
    const upsert = c.env.DB.prepare(
      `insert into session_logs
         (id, week, session_id, date, status, minutes, rpe, notes, result_seconds, environment, updated_at)
       values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       on conflict (id) do update set
         week = excluded.week, session_id = excluded.session_id, date = excluded.date,
         status = excluded.status, minutes = excluded.minutes, rpe = excluded.rpe,
         notes = excluded.notes, result_seconds = excluded.result_seconds,
         environment = excluded.environment, updated_at = excluded.updated_at
       where excluded.updated_at > session_logs.updated_at`,
    )
    await c.env.DB.batch(
      logs.map((l) =>
        upsert.bind(
          l.id, l.week, l.sessionId, l.date, l.status, l.minutes, l.rpe, l.notes, l.resultSeconds, l.environment, l.updatedAt,
        ),
      ),
    )
  }
  if (decisions.length > 0) {
    const upsert = c.env.DB.prepare(
      `insert into suggestion_decisions (id, decision, date, updated_at)
       values (?, ?, ?, ?)
       on conflict (id) do update set
         decision = excluded.decision, date = excluded.date, updated_at = excluded.updated_at
       where excluded.updated_at > suggestion_decisions.updated_at`,
    )
    await c.env.DB.batch(decisions.map((d) => upsert.bind(d.id, d.decision, d.date, d.updatedAt)))
  }
  return c.json(await readState(c.env.DB))
})

app.notFound((c) => c.json({ error: 'Not found' }, 404))

/** Either list may be left out; whatever is there must all be valid. */
function parseSyncRequest(body: unknown): { logs: SessionLog[]; decisions: SuggestionDecision[] } {
  if (typeof body !== 'object' || body === null) throw new Error('The body must be an object')
  const { sessionLogs = [], suggestionDecisions = [] } = body as Record<string, unknown>
  return { logs: parseLogs(sessionLogs), decisions: parseDecisions(suggestionDecisions) }
}

function parseDecisions(raw: unknown): SuggestionDecision[] {
  if (!Array.isArray(raw)) throw new Error('suggestionDecisions must be an array')
  if (raw.length > MAX_BATCH) throw new Error(`At most ${MAX_BATCH} decisions per sync`)
  return raw.map((value, i) => {
    try {
      return parseDecision(value)
    } catch (error) {
      throw new Error(`suggestionDecisions[${i}]: ${error instanceof Error ? error.message : 'invalid'}`)
    }
  })
}

function parseLogs(raw: unknown): SessionLog[] {
  if (!Array.isArray(raw)) throw new Error('sessionLogs must be an array')
  if (raw.length > MAX_BATCH) throw new Error(`At most ${MAX_BATCH} logs per sync`)
  return raw.map((value, i) => {
    try {
      const log = parseSessionLog(value)
      const session = findWeek(program, log.week)?.sessions.find((s) => s.id === log.sessionId)
      if (!session) throw new Error(`Week ${log.week} has no Session "${log.sessionId}"`)
      if (log.resultSeconds !== null && session.type !== '5k-test') {
        throw new Error('Only a 5K test has a result time')
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
  result_seconds: number | null
  environment: string | null
  updated_at: string
}

interface DecisionRow {
  id: string
  decision: string
  date: string
  updated_at: string
}

async function readState(db: D1Database): Promise<SyncState> {
  const [{ results }, decisions] = await db.batch<SessionLogRow | DecisionRow>([
    db.prepare('select * from session_logs order by date, updated_at'),
    db.prepare('select * from suggestion_decisions order by updated_at'),
  ]) as [D1Result<SessionLogRow>, D1Result<DecisionRow>]
  return {
    suggestionDecisions: decisions.results.map((row) =>
      parseDecision({ id: row.id, decision: row.decision, date: row.date, updatedAt: row.updated_at }),
    ),
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
        resultSeconds: row.result_seconds,
        environment: row.environment,
        updatedAt: row.updated_at,
      }),
    ),
  }
}

export default app
