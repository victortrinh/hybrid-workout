#!/usr/bin/env node
/**
 * Confirms the production address is behind Cloudflare Access: without a
 * session, both the app and the API must redirect to the Access login on
 * <team>.cloudflareaccess.com instead of answering.
 *
 *   npm run check:access -- https://compromised.<subdomain>.workers.dev
 *
 * The address can also come from the COMPROMISED_URL environment variable.
 */
const base = process.argv[2] ?? process.env.COMPROMISED_URL

if (!base) {
  console.error('Usage: npm run check:access -- https://compromised.<subdomain>.workers.dev')
  process.exit(2)
}

const paths = ['/', '/plan', '/api/health']
let failed = false

for (const path of paths) {
  const url = new URL(path, base)
  const res = await fetch(url, { redirect: 'manual' })
  const location = res.headers.get('location') ?? ''
  let host = ''
  try {
    host = new URL(location, url).hostname
  } catch {}
  const protectedByAccess =
    res.status >= 300 && res.status < 400 && host.endsWith('.cloudflareaccess.com')

  console.log(`${protectedByAccess ? 'ok  ' : 'FAIL'} ${url.pathname} → ${res.status}${location ? ` ${host}` : ''}`)
  if (!protectedByAccess) failed = true
}

if (failed) {
  console.error('\nAt least one path answered without the Access login. See docs/deploy.md, step 4.')
  process.exit(1)
}
console.log('\nEvery path redirects to the Cloudflare Access login.')
