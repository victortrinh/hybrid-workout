import AxeBuilder from '@axe-core/playwright'
import { expect, type Page } from '@playwright/test'

/** WCAG 2.2 AA, the bar PRODUCT.md sets. */
export async function expectNoAxeViolations(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'])
    .analyze()
  const summary = results.violations.map((v) => ({
    rule: v.id,
    impact: v.impact,
    help: v.help,
    nodes: v.nodes.map((n) => n.target.join(' ')),
  }))
  expect(summary).toEqual([])
}

/** Wednesday 11 November 2026, noon in Toronto: Week 3, the day the prototype shows. */
export const WEEK_3 = new Date('2026-11-11T12:00:00-05:00')

/** Tuesday 20 October 2026: six days before Week 1. */
export const BEFORE_WEEK_1 = new Date('2026-10-20T12:00:00-04:00')
