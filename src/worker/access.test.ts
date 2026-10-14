import { describe, expect, it } from 'vitest'
import { isServiceToken, type AccessEnv } from './access'

const TEAM = 'https://team.cloudflareaccess.com'
const env: AccessEnv = { ACCESS_CLIENT_ID: 'shortcut.access', ACCESS_CLIENT_SECRET: 'secret', ACCESS_TEAM_DOMAIN: TEAM }

const rsaKeys = async () =>
  (await crypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true,
    ['sign', 'verify'],
  )) as CryptoKeyPair
const { privateKey, publicKey } = await rsaKeys()
const jwk = { ...((await crypto.subtle.exportKey('jwk', publicKey)) as JsonWebKey), kid: 'k1' } as JsonWebKey
const keys = async () => [jwk]

const b64url = (data: Uint8Array | string) =>
  btoa(String.fromCharCode(...(typeof data === 'string' ? new TextEncoder().encode(data) : data)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')

/** An assertion as Access signs it for a service token, with any claim overridden. */
async function assertion(claims: Record<string, unknown> = {}, { kid = 'k1', key = privateKey } = {}) {
  const now = Math.floor(Date.now() / 1000)
  const head = b64url(JSON.stringify({ alg: 'RS256', kid, typ: 'JWT' }))
  const body = b64url(JSON.stringify({ iss: TEAM, common_name: 'shortcut.access', iat: now, exp: now + 300, ...claims }))
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(`${head}.${body}`))
  return `${head}.${body}.${b64url(new Uint8Array(signature))}`
}

const withAssertion = (jwt: string) => new Headers({ 'cf-access-jwt-assertion': jwt })

describe('isServiceToken', () => {
  it('takes Access’s signed assertion for the Shortcut’s token', async () => {
    expect(await isServiceToken(withAssertion(await assertion()), env, keys)).toBe(true)
  })

  it('refuses an assertion for another token, or a person', async () => {
    expect(await isServiceToken(withAssertion(await assertion({ common_name: 'other.access' })), env, keys)).toBe(false)
    expect(
      await isServiceToken(withAssertion(await assertion({ common_name: undefined, email: 'v@example.com' })), env, keys),
    ).toBe(false)
  })

  it('refuses an assertion that is expired, from another team, or not signed by Access', async () => {
    const { privateKey: stranger } = await rsaKeys()
    for (const jwt of [
      await assertion({ exp: Math.floor(Date.now() / 1000) - 10 }),
      await assertion({ iss: 'https://evil.cloudflareaccess.com' }),
      await assertion({}, { key: stranger }),
      await assertion({}, { kid: 'unknown' }),
      'not.a.jwt',
      'garbage',
    ]) {
      expect(await isServiceToken(withAssertion(jwt), env, keys)).toBe(false)
    }
  })

  it('takes the two headers themselves when they match the secrets: no Access in front', async () => {
    const headers = (id: string, secret: string) =>
      new Headers({ 'cf-access-client-id': id, 'cf-access-client-secret': secret })
    expect(await isServiceToken(headers('shortcut.access', 'secret'), env, keys)).toBe(true)
    expect(await isServiceToken(headers('shortcut.access', 'wrong'), env, keys)).toBe(false)
    expect(await isServiceToken(new Headers({ 'cf-access-client-id': 'shortcut.access' }), env, keys)).toBe(false)
  })

  it('refuses everything while the Worker has no Client ID', async () => {
    expect(await isServiceToken(withAssertion(await assertion()), { ACCESS_TEAM_DOMAIN: TEAM }, keys)).toBe(false)
  })
})
