import { useCallback, useEffect, useLayoutEffect, useRef } from 'react'
import { Button } from 'react-aria-components'
import { useIsPresent } from 'motion/react'
import { nowMs } from '../../domain/clock'
import { clock } from '../../domain/paces'
import { blockChangeCue } from '../liveCues'

/**
 * The rest between sets, on cobalt: "Rest", a bar that fills, the time left
 * and Skip. Shared by Live lifts and a Live run's checklist. Its clock is
 * written into the page without re-rendering, and its end buzzes and calls
 * `onOver` once, also when the page comes back after the rest ran out.
 * One row, so it fits under a sideways Live run too.
 */
export function RestCountdown({
  startedAt,
  seconds,
  onOver,
  onSkip,
}: {
  /** Epoch milliseconds. */
  startedAt: number
  seconds: number
  onOver: () => void
  onSkip: () => void
}) {
  const textRef = useRef<HTMLElement>(null)
  const fillRef = useRef<HTMLElement>(null)
  const onOverRef = useRef(onOver)
  onOverRef.current = onOver
  // Once Skip or the end has taken it away, it may still be on screen leaving: it's over by then.
  const present = useIsPresent()
  const presentRef = useRef(present)
  presentRef.current = present

  const left = useCallback((now: number) => Math.max(0, seconds - (now - startedAt) / 1000), [startedAt, seconds])

  const paint = useCallback(
    (now: number) => {
      const l = left(now)
      if (textRef.current) textRef.current.textContent = clock(Math.ceil(l - 0.001))
      if (fillRef.current) fillRef.current.style.width = `${Math.min(100, (1 - l / seconds) * 100)}%`
    },
    [left, seconds],
  )

  useLayoutEffect(() => paint(nowMs()))

  useEffect(() => {
    let timer = 0
    const tick = () => {
      if (!presentRef.current) return
      const now = nowMs()
      const l = left(now)
      if (l <= 0) {
        blockChangeCue()
        onOverRef.current()
        return
      }
      paint(now)
      const toNextSecond = (l * 1000) % 1000
      timer = window.setTimeout(tick, toNextSecond < 1 ? 1000 : toNextSecond)
    }
    tick()
    const visible = () => {
      if (document.visibilityState !== 'visible') return
      window.clearTimeout(timer)
      tick()
    }
    document.addEventListener('visibilitychange', visible)
    return () => {
      window.clearTimeout(timer)
      document.removeEventListener('visibilitychange', visible)
    }
  }, [left, paint])

  return (
    <div className="flex items-center gap-3.5">
      <span className="text-[17px] font-bold">Rest</span>
      <span aria-hidden="true" className="relative h-2 flex-1 overflow-hidden bg-cobalt-soft">
        <i ref={fillRef} className="lane-fill absolute inset-y-0 left-0 bg-on-cobalt" />
      </span>
      <b ref={textRef} role="timer" aria-label="Rest left" className="text-[26px] font-black font-stretch-125%" />
      <Button
        onPress={onSkip}
        className="min-h-11 min-w-11 cursor-pointer px-2 text-[15px] font-bold text-on-cobalt underline decoration-2 underline-offset-4 data-focus-visible:outline-3 data-focus-visible:outline-offset-2 data-focus-visible:outline-on-cobalt"
      >
        Skip
      </Button>
    </div>
  )
}
