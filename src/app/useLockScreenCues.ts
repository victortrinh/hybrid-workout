import { useCallback, useEffect, useRef, useState } from 'react'
import type { Cue } from '../domain/cues'
import type { LiveSession } from '../domain/lifts'
import type { RunContext } from '../domain/paces'
import { cuesFor } from './lockScreenCues'

const KEY = 'compromised:lock-screen-cues'

/**
 * Hands the Live session's cues to the server the moment the app goes off
 * screen, and takes them back when it returns, so the phone buzzes with the
 * lock-screen cue only while the page can't (ADR-0006). Does nothing until
 * lock-screen cues are turned on in Settings.
 */
export function useLockScreenCues(live: LiveSession | null, runContext: RunContext) {
  const latest = useRef({ live, runContext })
  latest.current = { live, runContext }
  /** Whether the server holds cues this page sent: only then is there anything to take back. */
  const handedOver = useRef(false)

  useEffect(() => {
    const hidden = () => {
      const { live, runContext } = latest.current
      if (!live || !isOn()) return
      const cues = cuesFor(live, runContext)
      if (cues.length === 0) return
      handedOver.current = true
      sendSchedule(cues)
    }
    const changed = () => {
      if (document.visibilityState === 'hidden') return hidden()
      if (!handedOver.current) return
      handedOver.current = false
      sendSchedule([])
    }
    document.addEventListener('visibilitychange', changed)
    // iOS may skip visibilitychange when it puts the app away.
    window.addEventListener('pagehide', hidden)
    return () => {
      document.removeEventListener('visibilitychange', changed)
      window.removeEventListener('pagehide', hidden)
    }
  }, [])
}

/** Keepalive, so the request still goes as the phone freezes the page. Silent on failure: the clock on screen is still right. */
function sendSchedule(cues: Cue[]) {
  void fetch('/api/cues/schedule', {
    method: 'PUT',
    keepalive: true,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ cues }),
  }).catch(() => {})
}

export type CuesStatus =
  /** Checking what this device can do. */
  | 'checking'
  /** No push here: a Safari tab rather than the Home Screen app, or an old iOS. */
  | 'unsupported'
  /** Notifications refused for the app; only iOS Settings can undo it. */
  | 'blocked'
  /** The server has no VAPID keys yet, or no cue timer (mock mode). */
  | 'unavailable'
  | 'off'
  | 'on'
  /** Turning on or off. */
  | 'busy'
  | 'failed'

export interface CuesSetting {
  status: CuesStatus
  turnOn: () => void
  turnOff: () => void
}

/** The Settings switch: subscribes this phone to push and tells the server, or undoes both. */
export function useCuesSetting(): CuesSetting {
  const [status, setStatus] = useState<CuesStatus>('checking')

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const next = await initialStatus()
      if (!cancelled) setStatus(next)
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const turnOn = useCallback(() => {
    setStatus('busy')
    // Asked first, straight from the tap: Safari only shows the prompt for a gesture.
    void Notification.requestPermission()
      .then(async (permission) => {
        if (permission === 'denied') return 'blocked'
        if (permission !== 'granted') return 'off'
        const key = await publicKey()
        if (!key) return 'unavailable'
        const registration = await navigator.serviceWorker.getRegistration()
        if (!registration) return 'unsupported'
        const subscription =
          (await registration.pushManager.getSubscription()) ??
          (await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: fromBase64Url(key) }))
        const response = await fetch('/api/cues/subscription', {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(subscription.toJSON()),
        })
        if (!response.ok) return 'failed'
        remember(true)
        return 'on'
      })
      .catch((): CuesStatus => 'failed')
      .then(setStatus)
  }, [])

  const turnOff = useCallback(() => {
    setStatus('busy')
    remember(false)
    void (async (): Promise<CuesStatus> => {
      const registration = await navigator.serviceWorker.getRegistration()
      await (await registration?.pushManager.getSubscription())?.unsubscribe()
      const response = await fetch('/api/cues/subscription', { method: 'DELETE' })
      return response.ok ? 'off' : 'failed'
    })()
      .catch((): CuesStatus => 'failed')
      .then(setStatus)
  }, [])

  return { status, turnOn, turnOff }
}

async function initialStatus(): Promise<CuesStatus> {
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) return 'unsupported'
  if (Notification.permission === 'denied') return 'blocked'
  if (isOn() && Notification.permission === 'granted') return 'on'
  try {
    return (await publicKey()) ? 'off' : 'unavailable'
  } catch {
    return 'failed'
  }
}

/** Null when the server has no key or no cue timer; throws with no signal. */
async function publicKey(): Promise<string | null> {
  const response = await fetch('/api/cues')
  if (!response.ok) return null
  return ((await response.json()) as { key: string | null }).key
}

function isOn(): boolean {
  try {
    return localStorage.getItem(KEY) === 'on'
  } catch {
    return false
  }
}

function remember(on: boolean) {
  try {
    if (on) localStorage.setItem(KEY, 'on')
    else localStorage.removeItem(KEY)
  } catch {
    // Storage blocked: the cues stay off on this device.
  }
}

function fromBase64Url(value: string): Uint8Array<ArrayBuffer> {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/')
  const binary = atob(base64 + '='.repeat((4 - (base64.length % 4)) % 4))
  return Uint8Array.from(binary, (c) => c.charCodeAt(0))
}
