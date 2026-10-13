/**
 * The Worker: the JSON API under /api, with the built app served as static
 * assets beside it (see `assets` in wrangler.jsonc). Cloudflare Access sits in
 * front of the whole site (ADR-0001), so no route here handles sign-in.
 */
import { Hono } from 'hono'

const app = new Hono<{ Bindings: Env }>().basePath('/api')

/** Liveness, including a round trip to D1, so a broken binding fails loudly. */
app.get('/health', async (c) => {
  const row = await c.env.DB.prepare('select 1 as ok').first<{ ok: number }>()
  return c.json({ ok: true, db: row?.ok === 1 })
})

app.notFound((c) => c.json({ error: 'Not found' }, 404))

export default app
