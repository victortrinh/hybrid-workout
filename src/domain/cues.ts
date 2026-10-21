/**
 * Lock-screen cues: what a Live session's clock says next, and when, sent
 * from the server as a push notification while the app is off screen
 * (ADR-0006). The page works the list out; the server only keeps time.
 */

export interface Cue {
  /** Epoch milliseconds. */
  at: number
  /** "Rep 2 of 5 · 4:10 /km" */
  title: string
  /** The Coach line: "Same speed. Same face." */
  body: string
}

/** More than any Session's Blocks; a longer list is a mistake. */
export const MAX_CUES = 200

/** Cues sent by the page, in time order, or an error. */
export function parseCues(value: unknown): Cue[] {
  if (!Array.isArray(value) || value.length > MAX_CUES) throw new Error(`Expected at most ${MAX_CUES} cues`)
  return value
    .map((cue): Cue => {
      const { at, title, body } = (cue ?? {}) as Record<string, unknown>
      if (typeof at !== 'number' || !Number.isFinite(at)) throw new Error('Cue needs a time')
      if (typeof title !== 'string' || title.length === 0 || title.length > 120) throw new Error('Cue needs a title')
      if (typeof body !== 'string' || body.length > 240) throw new Error('Cue body is too long')
      return { at, title, body }
    })
    .sort((a, b) => a.at - b.at)
}

/** A browser's push subscription, as `PushSubscription.toJSON()` gives it. */
export interface PushSubscriptionKeys {
  endpoint: string
  keys: { p256dh: string; auth: string }
}

const BASE64URL = /^[\w-]+$/

/** The subscription the phone sent, or an error: an https endpoint and its two keys. */
export function parseSubscription(value: unknown): PushSubscriptionKeys {
  const { endpoint, keys } = (value ?? {}) as Record<string, unknown>
  if (typeof endpoint !== 'string' || !URL.canParse(endpoint) || new URL(endpoint).protocol !== 'https:') {
    throw new Error('Subscription needs an https endpoint')
  }
  const { p256dh, auth } = (keys ?? {}) as Record<string, unknown>
  if (typeof p256dh !== 'string' || !BASE64URL.test(p256dh) || typeof auth !== 'string' || !BASE64URL.test(auth)) {
    throw new Error('Subscription needs its p256dh and auth keys')
  }
  return { endpoint, keys: { p256dh, auth } }
}
