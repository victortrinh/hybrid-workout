/**
 * The Worker's own Hono app (src/worker/index.ts), answering in the browser.
 * Nothing in the app changes for mock mode; only its bindings do: the mock
 * database.
 */
import app from '../worker/index'

export function mockApi(db: D1Database): (request: Request) => Promise<Response> {
  const env = { DB: db } satisfies Omit<Env, 'ACCESS_TEAM_DOMAIN' | 'CUES'>
  return async (request) => app.fetch(request, env as Env)
}
