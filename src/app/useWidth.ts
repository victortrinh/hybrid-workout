import { useCallback, useState } from 'react'

/**
 * The element's content width in whole pixels, kept current as it resizes,
 * so a chart can draw at its container's real width. 0 until measured.
 */
export function useWidth<T extends HTMLElement>(): [(element: T | null) => () => void, number] {
  const [width, setWidth] = useState(0)
  const ref = useCallback((element: T | null) => {
    if (!element) return () => {}
    const observer = new ResizeObserver(([entry]) => setWidth(Math.round(entry.contentRect.width)))
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  return [ref, width]
}
