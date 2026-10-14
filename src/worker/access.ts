/**
 * Is this request the morning Shortcut's Access service token (ADR-0001)?
 *
 * Behind Cloudflare Access, the Shortcut's two headers are checked at the
 * edge, and what reaches the Worker is Access's signed assertion,
 * `Cf-Access-Jwt-Assertion`, whose `common_name` is the token's Client ID.
 * The Worker verifies that signature against the team's public keys and
 * checks the Client ID is the Shortcut's. Without Access in front (local dev,
 * e2e), the two headers themselves are compared with the Worker's secrets.
 */

export interface AccessEnv {
  ACCESS_CLIENT_ID?: string
  ACCESS_CLIENT_SECRET?: string
  /** `https://<team>.cloudflareaccess.com`: where Access's signing keys are, and the assertion's issuer. */
  ACCESS_TEAM_DOMAIN?: string
}

/** Fetches the team's signing keys; replaceable in tests. */
export type FetchKeys = (teamDomain: string) => Promise<JsonWebKey[]>

export async function isServiceToken(headers: Headers, env: AccessEnv, fetchKeys: FetchKeys = teamKeys): Promise<boolean> {
  if (!env.ACCESS_CLIENT_ID) return false
  const assertion = headers.get('cf-access-jwt-assertion')
  if (assertion && env.ACCESS_TEAM_DOMAIN) {
    const claims = await verifiedClaims(assertion, env.ACCESS_TEAM_DOMAIN, fetchKeys)
    if (claims?.common_name === env.ACCESS_CLIENT_ID) return true
  }
  const id = headers.get('cf-access-client-id')
  const secret = headers.get('cf-access-client-secret')
  if (!env.ACCESS_CLIENT_SECRET || !id || !secret) return false
  const [a, b] = await Promise.all([sameText(id, env.ACCESS_CLIENT_ID), sameText(secret, env.ACCESS_CLIENT_SECRET)])
  return a && b
}

interface Claims {
  iss?: string
  exp?: number
  nbf?: number
  common_name?: string
}

/** The assertion's claims when Access signed it, it is current and it is from this team; otherwise null. */
async function verifiedClaims(token: string, teamDomain: string, fetchKeys: FetchKeys): Promise<Claims | null> {
  const parts = token.split('.')
  if (parts.length !== 3) return null
  try {
    const header = JSON.parse(text(parts[0])) as { alg?: string; kid?: string }
    if (header.alg !== 'RS256') return null
    const key = (await fetchKeys(teamDomain)).find((k) => (k as { kid?: string }).kid === header.kid)
    if (!key) return null
    const publicKey = await crypto.subtle.importKey('jwk', key, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, [
      'verify',
    ])
    const signed = new TextEncoder().encode(`${parts[0]}.${parts[1]}`)
    if (!(await crypto.subtle.verify('RSASSA-PKCS1-v1_5', publicKey, bytes(parts[2]), signed))) return null
    const claims = JSON.parse(text(parts[1])) as Claims
    // Token expiry checks real time, not the clock seam (src/domain/clock.ts):
    // a pinned mock date must never make an expired assertion look current.
    const now = Date.now() / 1000
    if (claims.iss !== teamDomain.replace(/\/+$/, '')) return null
    if (typeof claims.exp !== 'number' || claims.exp < now) return null
    if (typeof claims.nbf === 'number' && claims.nbf > now + 60) return null
    return claims
  } catch {
    return null
  }
}

/** Access rotates its keys every few weeks; an hour in this isolate's memory is plenty. Real time, like token expiry. */
let cache: { domain: string; keys: JsonWebKey[]; until: number } | null = null

async function teamKeys(teamDomain: string): Promise<JsonWebKey[]> {
  if (cache && cache.domain === teamDomain && cache.until > Date.now()) return cache.keys
  const response = await fetch(`${teamDomain.replace(/\/+$/, '')}/cdn-cgi/access/certs`)
  if (!response.ok) return []
  const { keys = [] } = (await response.json()) as { keys?: JsonWebKey[] }
  cache = { domain: teamDomain, keys, until: Date.now() + 3_600_000 }
  return keys
}

function bytes(base64url: string): Uint8Array<ArrayBuffer> {
  const base64 = base64url.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(base64url.length / 4) * 4, '=')
  return Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))
}

const text = (base64url: string) => new TextDecoder().decode(bytes(base64url))

/** Compares digests, so the time taken says nothing about how much matched. */
async function sameText(given: string, expected: string): Promise<boolean> {
  const digest = async (value: string) =>
    new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))
  const [x, y] = await Promise.all([digest(given), digest(expected)])
  return x.every((byte, i) => byte === y[i])
}
