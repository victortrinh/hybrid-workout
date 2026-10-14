/**
 * What a Live session asks of the phone, where the phone allows it: the
 * screen kept awake, and a buzz and a beep at every Block change. Each one
 * fails quietly; the Block's name and the Coach line on screen always say
 * the same thing.
 */

let wakeLock: WakeLockSentinel | null = null

/** Keeps the screen on. Ask again whenever the page comes back: the phone drops the lock when it's hidden. */
export async function keepAwake() {
  if (wakeLock && !wakeLock.released) return
  try {
    wakeLock = (await navigator.wakeLock?.request('screen')) ?? null
  } catch {
    // Battery saver, an unsupported browser or a hidden page.
  }
}

export function letSleep() {
  void wakeLock?.release().catch(() => {})
  wakeLock = null
}

let audio: AudioContext | null = null

/** Must run inside a tap: browsers only start sound from a gesture. */
export function unlockSound() {
  try {
    audio ??= new AudioContext()
    if (audio.state === 'suspended') void audio.resume()
  } catch {
    audio = null
  }
}

/** Two short beeps and a buzz: the Block changed. */
export function blockChangeCue() {
  try {
    navigator.vibrate?.([180, 80, 180])
  } catch {
    // No vibration motor, or not allowed.
  }
  if (!audio || audio.state !== 'running') return
  for (const offset of [0, 0.22]) {
    const start = audio.currentTime + offset
    const tone = audio.createOscillator()
    const gain = audio.createGain()
    tone.frequency.value = 880
    gain.gain.setValueAtTime(0.25, start)
    gain.gain.exponentialRampToValueAtTime(0.001, start + 0.16)
    tone.connect(gain).connect(audio.destination)
    tone.start(start)
    tone.stop(start + 0.18)
  }
}
