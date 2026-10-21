/**
 * The cue timer's rules, apart from the Durable Object that runs them so
 * they test in Node: one phone's push subscription, the cues still to send,
 * and an alarm on the next one.
 */
import type { Cue } from '../domain/cues'
import type { PushResult, Subscription } from './push'

/** The slice of Durable Object storage the keeper uses. */
export interface KeeperStorage {
  get<T>(key: string): Promise<T | undefined>
  put<T>(key: string, value: T): Promise<void>
  delete(key: string): Promise<boolean>
  setAlarm(at: number): Promise<void>
  deleteAlarm(): Promise<void>
}

export type Send = (subscription: Subscription, cue: Cue) => Promise<PushResult>

/** An alarm this close to a cue sends it: alarms can fire a touch early. */
const EARLY_MS = 250
/** A cue this late is stale: the app is likely back on screen, or the moment has passed. */
const STALE_MS = 60_000

export class CueKeeper {
  constructor(
    private storage: KeeperStorage,
    private send: Send,
  ) {}

  async subscribe(subscription: Subscription) {
    await this.storage.put('subscription', subscription)
  }

  async unsubscribe() {
    await this.storage.delete('subscription')
    await this.clear()
  }

  async subscribed(): Promise<boolean> {
    return (await this.storage.get<Subscription>('subscription')) !== undefined
  }

  /** Replaces every cue with these, from now on. */
  async schedule(cues: Cue[], now: number) {
    const ahead = cues.filter((c) => c.at > now - EARLY_MS)
    if (ahead.length === 0) return this.clear()
    await this.storage.put('cues', ahead)
    await this.storage.setAlarm(ahead[0].at)
  }

  async clear() {
    await this.storage.delete('cues')
    await this.storage.deleteAlarm()
  }

  /**
   * The alarm: sends the cue that's due. When several are (an alarm that
   * fired late), only the latest goes: it's where the clock is now.
   */
  async alarm(now: number) {
    const cues = (await this.storage.get<Cue[]>('cues')) ?? []
    const due = cues.filter((c) => c.at <= now + EARLY_MS)
    const rest = cues.filter((c) => c.at > now + EARLY_MS)
    const latest = due[due.length - 1]
    const subscription = await this.storage.get<Subscription>('subscription')
    if (latest && subscription && now - latest.at < STALE_MS) {
      if ((await this.send(subscription, latest)) === 'gone') {
        await this.storage.delete('subscription')
        return this.clear()
      }
    }
    if (rest.length === 0) return this.clear()
    await this.storage.put('cues', rest)
    await this.storage.setAlarm(rest[0].at)
  }
}
