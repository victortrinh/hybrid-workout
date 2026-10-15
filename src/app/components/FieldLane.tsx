import { useEffect, useState } from 'react'

/**
 * A field lane: a flat track in Cobalt Haze filling white from the left. It
 * starts empty and fills to `value` (0–1) once mounted, so progress reads as
 * motion; reduced motion skips the transition. Lanes stacked together pass
 * their `index` so they fill one after another, top lane first.
 */
export function FieldLane({ value, current = false, index = 0 }: { value: number; current?: boolean; index?: number }) {
  const [filled, setFilled] = useState(false)
  useEffect(() => {
    const frame = requestAnimationFrame(() => setFilled(true))
    return () => cancelAnimationFrame(frame)
  }, [])

  return (
    <span className={`relative block overflow-hidden bg-cobalt-soft ${current ? 'h-2' : 'h-[5px]'}`}>
      <i
        className="lane-fill absolute inset-y-0 left-0 bg-on-cobalt"
        style={{ width: `${filled ? Math.round(value * 100) : 0}%`, transitionDelay: `${index * 60}ms` }}
      />
    </span>
  )
}
