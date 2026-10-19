/**
 * Web Push from the Worker, with nothing but WebCrypto: the message encrypted
 * for one browser (RFC 8291, aes128gcm) and the request signed with the app's
 * VAPID key (RFC 8292), so Apple's push service delivers it to the phone.
 */

import type { PushSubscriptionKeys } from '../domain/cues'

export type Subscription = PushSubscriptionKeys

type Bytes = Uint8Array<ArrayBuffer>

/** The VAPID key pair as the Worker holds it: base64url, the public key uncompressed (65 bytes), the private key its 32-byte scalar. */
export interface VapidKeys {
  publicKey: string
  privateKey: string
  /** Who runs the app, for the push service: `mailto:` or `https:`. */
  subject: string
}

export type PushResult = 'sent' | 'gone' | 'failed'

/** How long the push service keeps trying: a cue a minute late is no use. */
const TTL_SECONDS = 60
/** One record holds the whole message: it's a sentence or two. */
const RECORD_SIZE = 4096

/**
 * Sends `payload` to one subscription. 'gone' means the browser dropped the
 * subscription (notifications turned off, app removed): forget it.
 */
export async function sendPush(
  subscription: Subscription,
  payload: string,
  vapid: VapidKeys,
  now: number,
  send: typeof fetch = fetch,
): Promise<PushResult> {
  const body = await encrypt(subscription, text(payload))
  const audience = new URL(subscription.endpoint).origin
  const jwt = await vapidJwt(audience, vapid, now)
  try {
    const response = await send(subscription.endpoint, {
      method: 'POST',
      headers: {
        TTL: `${TTL_SECONDS}`,
        Urgency: 'high',
        'Content-Encoding': 'aes128gcm',
        'Content-Type': 'application/octet-stream',
        Authorization: `vapid t=${jwt}, k=${vapid.publicKey}`,
      },
      body,
    })
    if (response.status === 404 || response.status === 410) return 'gone'
    return response.ok ? 'sent' : 'failed'
  } catch {
    return 'failed'
  }
}

/**
 * The message encrypted for the subscription's keys (RFC 8291 §3): a fresh
 * ECDH key and salt each time, one record, and the aes128gcm header in front.
 */
export async function encrypt(
  subscription: Subscription,
  plaintext: Bytes,
  { salt = crypto.getRandomValues(new Uint8Array(16)), keys }: { salt?: Bytes; keys?: CryptoKeyPair } = {},
): Promise<Bytes> {
  const uaPublic = fromBase64Url(subscription.keys.p256dh)
  const authSecret = fromBase64Url(subscription.keys.auth)
  const local = keys ?? ((await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])) as CryptoKeyPair)
  const asPublic = new Uint8Array((await crypto.subtle.exportKey('raw', local.publicKey)) as ArrayBuffer)
  const uaKey = await crypto.subtle.importKey('raw', uaPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, [])
  // The standard's `public`, which the Workers types spell `$public`.
  const ecdh = { name: 'ECDH', public: uaKey } as unknown as SubtleCryptoDeriveKeyAlgorithm
  const shared = new Uint8Array(await crypto.subtle.deriveBits(ecdh, local.privateKey, 256))

  const ikm = await hkdf(authSecret, shared, concat(text('WebPush: info\0'), uaPublic, asPublic), 32)
  const cek = await hkdf(salt, ikm, text('Content-Encoding: aes128gcm\0'), 16)
  const nonce = await hkdf(salt, ikm, text('Content-Encoding: nonce\0'), 12)

  // The last (and only) record ends with the 0x02 delimiter.
  const record = concat(plaintext, new Uint8Array([2]))
  const key = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt'])
  const sealed = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, key, record))

  const header = new Uint8Array(16 + 4 + 1)
  header.set(salt, 0)
  new DataView(header.buffer).setUint32(16, RECORD_SIZE)
  header[20] = asPublic.length
  return concat(header, asPublic, sealed)
}

/** The VAPID JWT (RFC 8292 §2): ES256, for the push service's origin, valid 12 hours. */
export async function vapidJwt(audience: string, vapid: VapidKeys, now: number): Promise<string> {
  const head = toBase64Url(text(JSON.stringify({ typ: 'JWT', alg: 'ES256' })))
  const claims = { aud: audience, exp: Math.floor(now / 1000) + 12 * 60 * 60, sub: vapid.subject }
  const body = toBase64Url(text(JSON.stringify(claims)))
  const key = await signingKey(vapid)
  // WebCrypto signs ECDSA as r‖s, which is exactly JWS's form.
  const signature = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, text(`${head}.${body}`))
  return `${head}.${body}.${toBase64Url(new Uint8Array(signature))}`
}

function signingKey({ publicKey, privateKey }: VapidKeys): Promise<CryptoKey> {
  const point = fromBase64Url(publicKey)
  if (point.length !== 65 || point[0] !== 4) throw new Error('VAPID public key must be an uncompressed P-256 point')
  const jwk: JsonWebKey = {
    kty: 'EC',
    crv: 'P-256',
    x: toBase64Url(point.slice(1, 33)),
    y: toBase64Url(point.slice(33, 65)),
    d: privateKey,
  }
  return crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign'])
}

/** HKDF-SHA-256 with a single expand block: every length here is 32 bytes or less. */
async function hkdf(salt: Bytes, ikm: Bytes, info: Bytes, length: number): Promise<Bytes> {
  const prk = await hmac(salt, ikm)
  return (await hmac(prk, concat(info, new Uint8Array([1])))).slice(0, length)
}

async function hmac(key: Bytes, data: Bytes): Promise<Bytes> {
  const k = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return new Uint8Array(await crypto.subtle.sign('HMAC', k, data))
}

const text = (s: string): Bytes => new Uint8Array(new TextEncoder().encode(s))

function concat(...parts: Uint8Array[]): Bytes {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let at = 0
  for (const part of parts) {
    out.set(part, at)
    at += part.length
  }
  return out
}

export function toBase64Url(data: Uint8Array): string {
  let binary = ''
  for (const byte of data) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function fromBase64Url(value: string): Bytes {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/')
  const binary = atob(base64 + '='.repeat((4 - (base64.length % 4)) % 4))
  return Uint8Array.from(binary, (c) => c.charCodeAt(0))
}
