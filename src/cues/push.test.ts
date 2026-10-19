import { describe, expect, it } from 'vitest'
import { encrypt, fromBase64Url, sendPush, toBase64Url, vapidJwt, type Subscription, type VapidKeys } from './push'

type Bytes = Uint8Array<ArrayBuffer>
const P256 = { name: 'ECDH', namedCurve: 'P-256' } as const
const bytes = async (buffer: Promise<ArrayBuffer>): Promise<Bytes> => new Uint8Array(await buffer)
const text = (s: string): Bytes => new Uint8Array(new TextEncoder().encode(s))
const join = (...parts: Uint8Array[]): Bytes => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  parts.reduce((at, p) => (out.set(p, at), at + p.length), 0)
  return out
}

/** A browser's side of a subscription: its key pair and auth secret. */
async function browser() {
  const keys = (await crypto.subtle.generateKey(P256, true, ['deriveBits'])) as CryptoKeyPair
  const point = await bytes(crypto.subtle.exportKey('raw', keys.publicKey) as Promise<ArrayBuffer>)
  const auth = crypto.getRandomValues(new Uint8Array(16))
  const subscription: Subscription = {
    endpoint: 'https://web.push.apple.com/QH4',
    keys: { p256dh: toBase64Url(point), auth: toBase64Url(auth) },
  }
  return { keys, point, auth, subscription }
}

/** HKDF-SHA-256 as WebCrypto's own HKDF does it, not the module's HMAC steps. */
async function hkdf(salt: Bytes, ikm: Bytes, info: Bytes, length: number): Promise<Bytes> {
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits'])
  return bytes(crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, length * 8))
}

/** RFC 8291 decryption, as the browser does it. */
async function decrypt(body: Bytes, phone: Awaited<ReturnType<typeof browser>>): Promise<string> {
  const salt = body.slice(0, 16)
  const keyLength = body[20]
  const asPublic = body.slice(21, 21 + keyLength)
  const sealed = body.slice(21 + keyLength)
  const sender = await crypto.subtle.importKey('raw', asPublic, P256, false, [])
  const algorithm = { name: 'ECDH', public: sender } as unknown as SubtleCryptoDeriveKeyAlgorithm
  const shared = await bytes(crypto.subtle.deriveBits(algorithm, phone.keys.privateKey, 256))
  const ikm = await hkdf(phone.auth, shared, join(text('WebPush: info\0'), phone.point, asPublic), 32)
  const cek = await hkdf(salt, ikm, text('Content-Encoding: aes128gcm\0'), 16)
  const nonce = await hkdf(salt, ikm, text('Content-Encoding: nonce\0'), 12)
  const key = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['decrypt'])
  const record = await bytes(crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce }, key, sealed))
  expect(record[record.length - 1]).toBe(2)
  return new TextDecoder().decode(record.slice(0, -1))
}

async function vapidKeys(): Promise<VapidKeys & { verifier: CryptoKey }> {
  const pair = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])) as CryptoKeyPair
  const point = await bytes(crypto.subtle.exportKey('raw', pair.publicKey) as Promise<ArrayBuffer>)
  const { d } = (await crypto.subtle.exportKey('jwk', pair.privateKey)) as JsonWebKey
  return { publicKey: toBase64Url(point), privateKey: d!, subject: 'mailto:athlete@example.com', verifier: pair.publicKey }
}

const json = (part: string) => JSON.parse(new TextDecoder().decode(fromBase64Url(part)))

describe('encrypt', () => {
  it('is what the browser decrypts with its key and auth secret', async () => {
    const phone = await browser()
    const message = JSON.stringify({ title: 'Rep 2 of 5', body: 'Same speed. Same face.' })
    const body = await encrypt(phone.subscription, text(message))
    expect(await decrypt(body, phone)).toBe(message)
  })

  it('carries the salt, a 4096-byte record size and its own public key in the header', async () => {
    const phone = await browser()
    const salt = new Uint8Array(16).fill(7)
    const body = await encrypt(phone.subscription, text('hi'), { salt })
    expect([...body.subarray(0, 16)]).toEqual([...salt])
    expect(new DataView(body.buffer, body.byteOffset).getUint32(16)).toBe(4096)
    expect(body[20]).toBe(65)
    expect(body[21]).toBe(4)
  })

  it('is new every time: a fresh key and salt per message', async () => {
    const phone = await browser()
    const plain = text('same')
    const [a, b] = [await encrypt(phone.subscription, plain), await encrypt(phone.subscription, plain)]
    expect(toBase64Url(a)).not.toBe(toBase64Url(b))
  })
})

describe('vapidJwt', () => {
  it('is an ES256 token for the push service, signed by the VAPID key', async () => {
    const keys = await vapidKeys()
    const now = Date.UTC(2026, 10, 1, 12)
    const jwt = await vapidJwt('https://web.push.apple.com', keys, now)
    const [head, body, signature] = jwt.split('.')
    expect(json(head)).toEqual({ typ: 'JWT', alg: 'ES256' })
    expect(json(body)).toEqual({ aud: 'https://web.push.apple.com', exp: now / 1000 + 12 * 60 * 60, sub: 'mailto:athlete@example.com' })
    const valid = await crypto.subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' },
      keys.verifier,
      fromBase64Url(signature),
      text(`${head}.${body}`),
    )
    expect(valid).toBe(true)
  })
})

describe('sendPush', () => {
  const now = Date.UTC(2026, 10, 1, 12)

  it('posts the encrypted message to the endpoint, signed, short-lived and urgent', async () => {
    const phone = await browser()
    const keys = await vapidKeys()
    const requests: { url: string; init: RequestInit }[] = []
    const send = (async (url: string, init: RequestInit) => {
      requests.push({ url, init })
      return new Response(null, { status: 201 })
    }) as typeof fetch
    expect(await sendPush(phone.subscription, '{"title":"Jog"}', keys, now, send)).toBe('sent')
    const [{ url, init }] = requests
    expect(url).toBe(phone.subscription.endpoint)
    const headers = init.headers as Record<string, string>
    expect(headers['Content-Encoding']).toBe('aes128gcm')
    expect(headers.TTL).toBe('60')
    expect(headers.Urgency).toBe('high')
    expect(headers.Authorization).toMatch(new RegExp(`^vapid t=[\\w-]+\\.[\\w-]+\\.[\\w-]+, k=${keys.publicKey}$`))
    expect(await decrypt(init.body as Bytes, phone)).toBe('{"title":"Jog"}')
  })

  it('says gone when the push service has dropped the subscription, failed on anything else', async () => {
    const phone = await browser()
    const keys = await vapidKeys()
    const answer = (status: number) => (async () => new Response(null, { status })) as unknown as typeof fetch
    expect(await sendPush(phone.subscription, 'x', keys, now, answer(410))).toBe('gone')
    expect(await sendPush(phone.subscription, 'x', keys, now, answer(404))).toBe('gone')
    expect(await sendPush(phone.subscription, 'x', keys, now, answer(500))).toBe('failed')
    const offline = (async () => {
      throw new TypeError('network')
    }) as unknown as typeof fetch
    expect(await sendPush(phone.subscription, 'x', keys, now, offline)).toBe('failed')
  })
})
