import { AnimatePresence, MotionConfig, useReducedMotion, type TargetAndTransition, type Transition } from 'motion/react'
import { useEffect, useRef, type ReactNode } from 'react'

/**
 * Lanes '76 in motion (DESIGN.md, Motion): things wipe in from the left or
 * fill from the start line, fast and hard-ended, on the lane easing. No
 * bounce, no scale-pop, no overshoot. Under reduced motion every Motion
 * animation is skipped and values land at once.
 */
export const EASE_LANE = [0.16, 1, 0.3, 1] as const

/** Seconds: a press, a UI change, a screen or block arriving, a lane filling. */
export const DUR = { tap: 0.12, ui: 0.18, enter: 0.24, fill: 0.9 } as const

export const lane = (duration: number = DUR.ui, delay = 0): Transition => ({ ease: EASE_LANE, duration, delay })

/** Rows and cells arrive left to right (or top to bottom) 30ms apart; past the eighth they all arrive together. */
export const stagger = (i: number) => Math.min(i, 8) * 0.03

/** A screen, a heading, a label: in from just left of where it sits. */
export const wipeIn = {
  initial: { opacity: 0, x: -8 },
  animate: { opacity: 1, x: 0 },
  transition: lane(DUR.enter),
} as const

/** The Live field band, unrolling from the top as a session opens. */
export const dropIn = {
  initial: { clipPath: 'inset(0 0 100% 0)' },
  animate: { clipPath: 'inset(0 0 0% 0)' },
  transition: lane(DUR.enter),
} as const

/** A strip or toast from the bottom: up a few pixels into place. */
export const riseIn = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: 8 },
  transition: lane(DUR.ui),
} as const

/** The app's one Motion setup: the lane easing by default, nothing at all under reduced motion. */
export function LaneMotion({ children }: { children: ReactNode }) {
  const reduce = useReducedMotion() ?? false
  return (
    <MotionConfig transition={lane()} skipAnimations={reduce} reducedMotion="user">
      {children}
    </MotionConfig>
  )
}

/**
 * False on a component's first render, true after: for a cue that plays when
 * something changes (a set logged) but not when the screen opens on it already done.
 */
export function useMounted() {
  const mounted = useRef(false)
  useEffect(() => {
    mounted.current = true
  }, [])
  return mounted.current
}

/**
 * Whether entrances play. Under reduced motion they don't, and nothing starts
 * in its "before" state: skipped animations still settle on the next frame,
 * and a page whose frames are paused (a test's fake clock) would keep a band
 * clipped or a screen at opacity 0.
 */
export function useEntrances() {
  return !(useReducedMotion() ?? false)
}

type Preset = {
  initial: TargetAndTransition
  animate: TargetAndTransition
  exit?: TargetAndTransition
  transition: Transition
}

/** A preset's props, played only when `on` (entrances allowed, and whatever else the caller needs). */
export function play(preset: Preset, on: boolean): Omit<Preset, 'initial'> & { initial: TargetAndTransition | false } {
  return on ? preset : { initial: false, animate: preset.animate, transition: preset.transition }
}

/** AnimatePresence, or nothing in the way under reduced motion: what leaves is gone at once. */
export function LanePresence({ children, popLayout = false }: { children: ReactNode; popLayout?: boolean }) {
  if (!useEntrances()) return children
  return (
    <AnimatePresence initial={false} mode={popLayout ? 'popLayout' : 'sync'}>
      {children}
    </AnimatePresence>
  )
}
