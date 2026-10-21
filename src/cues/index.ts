/**
 * The cue timer: a Worker of its own, `compromised-cues`, holding one Durable
 * Object that keeps a Live session's cues and sends each as a push
 * notification on time (ADR-0006). It has no address; only the app's Worker
 * reaches it, through its `CUES` binding. It's apart from the app's Worker
 * because Cloudflare makes no preview URLs for a Worker with a Durable Object.
 */
import { DurableObject } from 'cloudflare:workers'
import { nowMs } from '../domain/clock'
import type { Cue } from '../domain/cues'
import { CueKeeper } from './keeper'
import { sendPush, type Subscription } from './push'

export interface CuesEnv {
  /** base64url, uncompressed P-256 point: given to the browser to subscribe with. */
  VAPID_PUBLIC_KEY: string
  /** base64url P-256 private scalar. A secret. */
  VAPID_PRIVATE_KEY: string
  /** `mailto:` or `https:`, for the push service. */
  VAPID_SUBJECT: string
}

export class LiveCues extends DurableObject<CuesEnv> {
  private keeper = new CueKeeper(this.ctx.storage, async (subscription, cue) => {
    const vapid = { publicKey: this.env.VAPID_PUBLIC_KEY, privateKey: this.env.VAPID_PRIVATE_KEY, subject: this.env.VAPID_SUBJECT }
    const result = await sendPush(subscription, JSON.stringify(cue), vapid, nowMs(), (url, init) =>
      fetch(url, init).then((response) => {
        if (!response.ok) console.warn('Push refused', response.status, new URL(subscription.endpoint).host)
        return response
      }),
    )
    if (result === 'gone') console.warn('Subscription gone: turn Lock-screen cues on again')
    return result
  })

  /** Null until the VAPID keys are set (docs/deploy.md, step 9). */
  publicKey(): string | null {
    return this.env.VAPID_PUBLIC_KEY && this.env.VAPID_PRIVATE_KEY && this.env.VAPID_SUBJECT ? this.env.VAPID_PUBLIC_KEY : null
  }

  subscribe(subscription: Subscription) {
    return this.keeper.subscribe(subscription)
  }

  unsubscribe() {
    return this.keeper.unsubscribe()
  }

  subscribed() {
    return this.keeper.subscribed()
  }

  schedule(cues: Cue[]) {
    return this.keeper.schedule(cues, nowMs())
  }

  clear() {
    return this.keeper.clear()
  }

  override async alarm() {
    await this.keeper.alarm(nowMs())
  }
}

export default {
  fetch: () => new Response('Not found', { status: 404 }),
} satisfies ExportedHandler<CuesEnv>
