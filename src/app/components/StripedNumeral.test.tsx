import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { numeralEms, StripedNumeral } from './StripedNumeral'

describe('StripedNumeral', () => {
  it('keeps the decimal point out of the stripes, in its own solid layer', () => {
    const html = renderToStaticMarkup(<StripedNumeral value="12.2" />)
    expect(html).toBe(
      '<span class="stripe-num" style="--ems:2.665">12<span class="pt">.</span>2<i class="bl" aria-hidden="true"></i></span>',
    )
  })

  it('renders a whole number with only the baseline marker', () => {
    expect(renderToStaticMarkup(<StripedNumeral value="168" className="text-numeral" />)).toBe(
      '<span class="stripe-num text-numeral" style="--ems:2.325">168<i class="bl" aria-hidden="true"></i></span>',
    )
  })

  it('knows its own width in ems, so a 4-character value can be sized to fit', () => {
    expect(numeralEms('12.3')).toBe(2.665)
    expect(numeralEms('1000')).toBe(3.1)
    expect(numeralEms('20')).toBe(1.55)
  })
})
