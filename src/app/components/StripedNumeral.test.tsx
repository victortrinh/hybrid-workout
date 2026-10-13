import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { StripedNumeral } from './StripedNumeral'

describe('StripedNumeral', () => {
  it('keeps the decimal point out of the stripes, in its own solid layer', () => {
    const html = renderToStaticMarkup(<StripedNumeral value="12.2" />)
    expect(html).toBe(
      '<span class="stripe-num">12<span class="pt">.</span>2<i class="bl" aria-hidden="true"></i></span>',
    )
  })

  it('renders a whole number with only the baseline marker', () => {
    expect(renderToStaticMarkup(<StripedNumeral value="168" className="text-numeral" />)).toBe(
      '<span class="stripe-num text-numeral">168<i class="bl" aria-hidden="true"></i></span>',
    )
  })
})
