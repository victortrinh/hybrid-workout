import { useLayoutEffect, useRef } from 'react'

/**
 * The screen's hero number, set expanded and black with horizontal stripes cut
 * through it in the surface colour (The Striped Numeral Rule).
 *
 * Stripes are phased so whole bands land on the glyph's top and on the
 * baseline: we measure the digits' real ascent with a canvas and the baseline
 * with a zero-size marker, then fit a whole number of stripe periods between.
 * The decimal point stays solid above the stripes.
 */
export function StripedNumeral({ value, className }: { value: string; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null)

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const phase = () => phaseStripes(el)
    phase()
    let live = true
    document.fonts?.ready.then(() => live && phase())
    const resize = new ResizeObserver(phase)
    resize.observe(el)
    return () => {
      live = false
      resize.disconnect()
    }
  }, [value])

  const [whole, decimals] = value.split('.')
  return (
    <span ref={ref} className={className ? `stripe-num ${className}` : 'stripe-num'}>
      {whole}
      {decimals !== undefined && (
        <>
          <span className="pt">.</span>
          {decimals}
        </>
      )}
      <i className="bl" aria-hidden="true" />
    </span>
  )
}

let measure: CanvasRenderingContext2D | null = null

function phaseStripes(el: HTMLElement) {
  const style = getComputedStyle(el)
  const fontSize = parseFloat(style.fontSize)
  const baselineMarker = el.querySelector('.bl')
  if (!fontSize || !baselineMarker) return

  measure ??= document.createElement('canvas').getContext('2d')
  if (!measure) return
  measure.font = `${style.fontWeight} ${fontSize}px ${style.fontFamily}`
  measure.fontStretch = 'expanded' // 125%, the numeral width
  const digits = (el.textContent ?? '').replace('.', '')
  const ascent = measure.measureText(digits).actualBoundingBoxAscent || fontSize * 0.72

  const baseline = baselineMarker.getBoundingClientRect().top - el.getBoundingClientRect().top
  const stripe = Math.max(2, Math.round(fontSize * 0.03))
  const gap = fontSize * 0.085
  const periods = Math.max(3, Math.round((ascent + stripe) / (gap + stripe)))
  const period = (ascent + stripe) / periods

  el.style.setProperty('--st', `${(baseline - ascent).toFixed(2)}px`)
  el.style.setProperty('--ch', `${ascent.toFixed(2)}px`)
  el.style.setProperty('--per', `${period.toFixed(3)}px`)
  el.style.setProperty('--band', `${(period - stripe).toFixed(3)}px`)
}
