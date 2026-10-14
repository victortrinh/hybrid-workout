/**
 * The Worker: the JSON API under /api, with the built app served as static
 * assets beside it (see `assets` in wrangler.jsonc). Cloudflare Access sits in
 * front of the whole site (ADR-0001), so no route here handles sign-in.
 */
import { Hono } from 'hono'
import { isServiceToken } from './access'
import { parseActivity, parseActivityAnswer, type Activity, type ActivityAnswer } from '../domain/activity'
import { findWeek } from '../domain/coach'
import { isCircuit, isLiveRun } from '../domain/live'
import { parseSessionLog, type SessionLog, type StationPart, type SyncState } from '../domain/log'
import { parsePainReport, type PainReport } from '../domain/pain'
import { program } from '../domain/program/program'
import { parseRecoveryNight, type RecoveryNight } from '../domain/recovery'
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
  let reports: PainReport[]
  let answers: ActivityAnswer[]
  try {
    ;({ logs, decisions, reports, answers } = parseSyncRequest(await c.req.json()))
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : 'Invalid request' }, 400)
  }

  if (logs.length > 0) {
    const upsert = c.env.DB.prepare(
      `insert into session_logs
         (id, week, session_id, date, status, minutes, rpe, notes, result_seconds, environment, distance_meters, updated_at)
       values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       on conflict (id) do update set
         week = excluded.week, session_id = excluded.session_id, date = excluded.date,
         status = excluded.status, minutes = excluded.minutes, rpe = excluded.rpe,
         notes = excluded.notes, result_seconds = excluded.result_seconds,
         environment = excluded.environment, distance_meters = excluded.distance_meters,
         updated_at = excluded.updated_at
       where excluded.updated_at > session_logs.updated_at`,
    )
    // A log's reps go with the log: replaced only when this edit is the one stored, so an older replay changes nothing.
    const clearReps = c.env.DB.prepare(
      `delete from interval_logs where session_log_id = ?1
         and exists (select 1 from session_logs where id = ?1 and updated_at = ?2)`,
    )
    const clearSets = c.env.DB.prepare(
      `delete from set_logs where session_log_id = ?1
         and exists (select 1 from session_logs where id = ?1 and updated_at = ?2)`,
    )
    const addSet = c.env.DB.prepare(
      `insert into set_logs (session_log_id, exercise, "set", lift, pounds, reps, rpe)
       select ?1, ?2, ?3, ?4, ?5, ?6, ?7
       where exists (select 1 from session_logs where id = ?1 and updated_at = ?8)`,
    )
    const addRep = c.env.DB.prepare(
      `insert into interval_logs (session_log_id, block, rep, target_pace, held, actual_pace)
       select ?1, ?2, ?3, ?4, ?5, ?6
       where exists (select 1 from session_logs where id = ?1 and updated_at = ?7)`,
    )
    // Station logs, the same way.
    const clearStations = c.env.DB.prepare(
      `delete from station_logs where session_log_id = ?1
         and exists (select 1 from session_logs where id = ?1 and updated_at = ?2)`,
    )
    const addStation = c.env.DB.prepare(
      `insert into station_logs (session_log_id, round, part, pounds, meters, reps, seconds)
       select ?1, ?2, ?3, ?4, ?5, ?6, ?7
       where exists (select 1 from session_logs where id = ?1 and updated_at = ?8)`,
    )
    await c.env.DB.batch(
      logs.flatMap((l) => [
        upsert.bind(
          l.id, l.week, l.sessionId, l.date, l.status, l.minutes, l.rpe, l.notes, l.resultSeconds, l.environment,
          l.distanceMeters, l.updatedAt,
        ),
        clearReps.bind(l.id, l.updatedAt),
        ...l.intervals.map((i) =>
          addRep.bind(l.id, i.block, i.rep, i.targetPace, i.held ? 1 : 0, i.actualPace, l.updatedAt),
        ),
        clearStations.bind(l.id, l.updatedAt),
        ...l.stations.map((s) => addStation.bind(l.id, s.round, s.part, s.pounds, s.meters, s.reps, s.seconds, l.updatedAt)),
        clearSets.bind(l.id, l.updatedAt),
        ...l.sets.map((s) => addSet.bind(l.id, s.exercise, s.set, s.lift, s.pounds, s.reps, s.rpe, l.updatedAt)),
      ]),
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
  if (reports.length > 0) {
    const upsert = c.env.DB.prepare(
      `insert into pain_reports (id, date, score, area, week, session_id, updated_at)
       values (?, ?, ?, ?, ?, ?, ?)
       on conflict (id) do update set
         date = excluded.date, score = excluded.score, area = excluded.area,
         week = excluded.week, session_id = excluded.session_id, updated_at = excluded.updated_at
       where excluded.updated_at > pain_reports.updated_at`,
    )
    await c.env.DB.batch(reports.map((r) => upsert.bind(r.id, r.date, r.score, r.area, r.week, r.sessionId, r.updatedAt)))
  }
  if (answers.length > 0) {
    const upsert = c.env.DB.prepare(
      `insert into activity_answers (activity_id, week, session_id, updated_at)
       values (?, ?, ?, ?)
       on conflict (activity_id) do update set
         week = excluded.week, session_id = excluded.session_id, updated_at = excluded.updated_at
       where excluded.updated_at > activity_answers.updated_at`,
    )
    await c.env.DB.batch(answers.map((a) => upsert.bind(a.activityId, a.week, a.sessionId, a.updatedAt)))
  }
  return c.json(await readState(c.env.DB))
})

/**
 * One night of Recovery data from the morning iOS Shortcut (ADR-0003). Only
 * the Access service token gets in: Cloudflare Access checks it at the edge
 * (ADR-0001), and the Worker checks it again against its own copy, so a
 * signed-in browser can't post nights and a missing Access policy fails closed.
 * Idempotent per morning: the latest send for a date replaces the last.
 */
app.post('/recovery', async (c) => {
  if (!(await isServiceToken(c.req.raw.headers, c.env))) {
    return c.json({ error: 'Send the Access service token: CF-Access-Client-Id and CF-Access-Client-Secret' }, 401)
  }
  let night: RecoveryNight
  try {
    night = parseRecoveryNight(await c.req.json(), new Date().toISOString())
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : 'Invalid request' }, 400)
  }
  await c.env.DB.prepare(
    `insert into recovery_nights (date, sleep_minutes, hrv_ms, resting_heart_rate, source, received_at)
     values (?, ?, ?, ?, ?, ?)
     on conflict (date) do update set
       sleep_minutes = excluded.sleep_minutes, hrv_ms = excluded.hrv_ms,
       resting_heart_rate = excluded.resting_heart_rate, source = excluded.source,
       received_at = excluded.received_at`,
  )
    .bind(night.date, night.sleepMinutes, night.hrvMs, night.restingHeartRate, night.source, night.receivedAt)
    .run()
  return c.json({ ok: true, night })
})

/**
 * One workout from the Workout Shortcut, read from Apple Health when an Apple
 * Watch workout ends (ADR-0004). The same service token as /api/recovery, the
 * same checks. Idempotent per workout: it is keyed on its start, so a resend
 * replaces it.
 */
app.post('/activities', async (c) => {
  if (!(await isServiceToken(c.req.raw.headers, c.env))) {
    return c.json({ error: 'Send the Access service token: CF-Access-Client-Id and CF-Access-Client-Secret' }, 401)
  }
  let activity: Activity
  try {
    activity = parseActivity(await c.req.json(), new Date().toISOString())
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : 'Invalid request' }, 400)
  }
  await c.env.DB.prepare(
    `insert into activities
       (id, date, workout_type, minutes, distance_meters, average_heart_rate, max_heart_rate, indoor, received_at)
     values (?, ?, ?, ?, ?, ?, ?, ?, ?)
     on conflict (id) do update set
       date = excluded.date, workout_type = excluded.workout_type, minutes = excluded.minutes,
       distance_meters = excluded.distance_meters, average_heart_rate = excluded.average_heart_rate,
       max_heart_rate = excluded.max_heart_rate, indoor = excluded.indoor, received_at = excluded.received_at`,
  )
    .bind(
      activity.id, activity.date, activity.workoutType, activity.minutes, activity.distanceMeters,
      activity.averageHeartRate, activity.maxHeartRate, activity.indoor === null ? null : activity.indoor ? 1 : 0,
      activity.receivedAt,
    )
    .run()
  return c.json({ ok: true, activity })
})

app.notFound((c) => c.json({ error: 'Not found' }, 404))

/** Any list may be left out; whatever is there must all be valid. */
function parseSyncRequest(body: unknown): {
  logs: SessionLog[]
  decisions: SuggestionDecision[]
  reports: PainReport[]
  answers: ActivityAnswer[]
} {
  if (typeof body !== 'object' || body === null) throw new Error('The body must be an object')
  const { sessionLogs = [], suggestionDecisions = [], painReports = [], activityAnswers = [] } = body as Record<
    string,
    unknown
  >
  return {
    logs: parseLogs(sessionLogs),
    decisions: parseDecisions(suggestionDecisions),
    reports: parseReports(painReports),
    answers: parseAnswers(activityAnswers),
  }
}

function parseAnswers(raw: unknown): ActivityAnswer[] {
  if (!Array.isArray(raw)) throw new Error('activityAnswers must be an array')
  if (raw.length > MAX_BATCH) throw new Error(`At most ${MAX_BATCH} answers per sync`)
  return raw.map((value, i) => {
    try {
      const answer = parseActivityAnswer(value)
      if (answer.week !== null && !findWeek(program, answer.week)?.sessions.some((s) => s.id === answer.sessionId)) {
        throw new Error(`Week ${answer.week} has no Session "${answer.sessionId}"`)
      }
      return answer
    } catch (error) {
      throw new Error(`activityAnswers[${i}]: ${error instanceof Error ? error.message : 'invalid'}`)
    }
  })
}

function parseReports(raw: unknown): PainReport[] {
  if (!Array.isArray(raw)) throw new Error('painReports must be an array')
  if (raw.length > MAX_BATCH) throw new Error(`At most ${MAX_BATCH} pain reports per sync`)
  return raw.map((value, i) => {
    try {
      const report = parsePainReport(value)
      if (report.week !== null && !findWeek(program, report.week)?.sessions.some((s) => s.id === report.sessionId)) {
        throw new Error(`Week ${report.week} has no Session "${report.sessionId}"`)
      }
      return report
    } catch (error) {
      throw new Error(`painReports[${i}]: ${error instanceof Error ? error.message : 'invalid'}`)
    }
  })
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
      if (log.intervals.length > 0 && !isLiveRun(session)) throw new Error('Only a run Session has reps to log')
      if (log.stations.length > 0 && !isCircuit(session)) {
        throw new Error('Only HYROX and a Race simulation have Station logs')
      }
      if (log.sets.length > 0 && session.type !== 'strength') throw new Error('Only a Strength session has sets to log')
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
  distance_meters: number | null
  updated_at: string
}

interface IntervalRow {
  session_log_id: string
  block: number
  rep: number
  target_pace: number | null
  held: number
  actual_pace: number | null
}

interface PainRow {
  id: string
  date: string
  score: number
  area: string | null
  week: number | null
  session_id: string | null
  updated_at: string
}

interface StationRow {
  session_log_id: string
  round: number
  part: string
  pounds: number | null
  meters: number | null
  reps: number | null
  seconds: number | null
}

interface SetRow {
  session_log_id: string
  exercise: number
  set: number
  lift: string | null
  pounds: number | null
  reps: number
  rpe: number
}

interface RecoveryRow {
  date: string
  sleep_minutes: number
  hrv_ms: number | null
  resting_heart_rate: number | null
  source: string
  received_at: string
}

interface ActivityRow {
  id: string
  workout_type: string
  minutes: number
  distance_meters: number | null
  average_heart_rate: number | null
  max_heart_rate: number | null
  indoor: number | null
  received_at: string
}

interface AnswerRow {
  activity_id: string
  week: number | null
  session_id: string | null
  updated_at: string
}

interface DecisionRow {
  id: string
  decision: string
  date: string
  updated_at: string
}

async function readState(db: D1Database): Promise<SyncState> {
  const [{ results }, decisions, intervals, stationRows, setRows, pain, nights, activityRows, answerRows] = (await db.batch<
    SessionLogRow | DecisionRow | IntervalRow | StationRow | SetRow | PainRow | RecoveryRow | ActivityRow | AnswerRow
  >([
    db.prepare('select * from session_logs order by date, updated_at'),
    db.prepare('select * from suggestion_decisions order by updated_at'),
    db.prepare('select * from interval_logs order by session_log_id, block'),
    db.prepare('select * from station_logs order by session_log_id, round, rowid'),
    db.prepare('select * from set_logs order by session_log_id, exercise, "set"'),
    db.prepare('select * from pain_reports order by date, updated_at'),
    db.prepare('select * from recovery_nights order by date'),
    db.prepare('select * from activities order by id'),
    db.prepare('select * from activity_answers order by updated_at'),
  ])) as [
    D1Result<SessionLogRow>,
    D1Result<DecisionRow>,
    D1Result<IntervalRow>,
    D1Result<StationRow>,
    D1Result<SetRow>,
    D1Result<PainRow>,
    D1Result<RecoveryRow>,
    D1Result<ActivityRow>,
    D1Result<AnswerRow>,
  ]
  const reps = new Map<string, IntervalRow[]>()
  for (const row of intervals.results) reps.set(row.session_log_id, [...(reps.get(row.session_log_id) ?? []), row])
  const stationLogs = new Map<string, StationRow[]>()
  for (const row of stationRows.results) {
    stationLogs.set(row.session_log_id, [...(stationLogs.get(row.session_log_id) ?? []), row])
  }
  const sets = new Map<string, SetRow[]>()
  for (const row of setRows.results) sets.set(row.session_log_id, [...(sets.get(row.session_log_id) ?? []), row])
  return {
    activities: activityRows.results.map((row) =>
      parseActivity(
        {
          type: row.workout_type,
          start: row.id,
          minutes: row.minutes,
          distanceMeters: row.distance_meters,
          averageHeartRate: row.average_heart_rate,
          maxHeartRate: row.max_heart_rate,
          indoor: row.indoor === null ? null : row.indoor === 1,
        },
        row.received_at,
      ),
    ),
    activityAnswers: answerRows.results.map((row) =>
      parseActivityAnswer({
        activityId: row.activity_id,
        week: row.week,
        sessionId: row.session_id,
        updatedAt: row.updated_at,
      }),
    ),
    recoveryNights: nights.results.map((row) =>
      parseRecoveryNight(
        {
          date: row.date,
          sleepMinutes: row.sleep_minutes,
          hrvMs: row.hrv_ms,
          restingHeartRate: row.resting_heart_rate,
          source: row.source,
        },
        row.received_at,
      ),
    ),
    painReports: pain.results.map((row) =>
      parsePainReport({
        id: row.id,
        date: row.date,
        score: row.score,
        area: row.area,
        week: row.week,
        sessionId: row.session_id,
        updatedAt: row.updated_at,
      }),
    ),
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
        distanceMeters: row.distance_meters,
        intervals: (reps.get(row.id) ?? []).map((rep) => ({
          block: rep.block,
          rep: rep.rep,
          targetPace: rep.target_pace,
          held: rep.held === 1,
          actualPace: rep.actual_pace,
        })),
        stations: (stationLogs.get(row.id) ?? []).map((s) => ({
          round: s.round,
          part: s.part as StationPart,
          pounds: s.pounds,
          meters: s.meters,
          reps: s.reps,
          seconds: s.seconds,
        })),
        sets: (sets.get(row.id) ?? []).map((s) => ({
          exercise: s.exercise,
          set: s.set,
          lift: s.lift,
          pounds: s.pounds,
          reps: s.reps,
          rpe: s.rpe,
        })),
        updatedAt: row.updated_at,
      }),
    ),
  }
}

export default app
