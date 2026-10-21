/**
 * The Worker's own Hono app (src/worker/index.ts), answering in the browser.
 * Nothing in the app changes for mock mode; only its bindings do: the mock
 * database, and a service token pair with no Access team domain, so the
 * Shortcut routes compare the two headers (src/worker/access.ts).
 */
import app from '../worker/index'

/** The Shortcut's Access service token in mock mode. Not a secret: it opens nothing but the mock. */
export const MOCK_SERVICE_TOKEN = { id: 'mock-shortcut.access', secret: 'mock-shortcut-secret' } as const

export function mockApi(db: D1Database): (request: Request) => Promise<Response> {
  const env = {
    DB: db,
    ACCESS_CLIENT_ID: MOCK_SERVICE_TOKEN.id,
    ACCESS_CLIENT_SECRET: MOCK_SERVICE_TOKEN.secret,
  } satisfies Omit<Env, 'ACCESS_TEAM_DOMAIN' | 'CUES'>
  return async (request) => app.fetch(request, env as Env)
}
