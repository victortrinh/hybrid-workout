import { expect, test } from '@playwright/test'
import { expectNoAxeViolations } from './axe'
import { serveHistory } from './history'
import { doToday } from './today'

/** Tuesday 3 November 2026, Week 2. */
const WEEK_2_TUESDAY = new Date('2026-11-03T12:00:00-05:00')

/**
 * Catch-up (ADR-0007): Week 1's Threshold (Key) and HYROX were never logged,
 * so they wait, Late, ahead of Week 2, and Up next is the oldest of them.
 */
test('serves the Late sessions first, says how far behind, and still lets a current-Week Session be picked', async ({
  page,
}) => {
  await serveHistory(page, [
    { week: 1, sessionId: 'speed', date: '2026-10-26', status: 'done' },
    { week: 1, sessionId: 'strength', date: '2026-10-28', status: 'done' },
  ])
  await page.clock.setFixedTime(WEEK_2_TUESDAY)
  await page.goto('/')

  await expect(page.getByRole('heading', { level: 1 })).toHaveText(/^Threshold, 3\s×\s7′/)
  // Up next's meta line says where it's from.
  const lateMeta = page.locator('p', { hasText: /^Week 1 · Late/ })
  await expect(lateMeta).toBeVisible()
  await expect(page.getByText('2 Sessions behind · Week 1')).toBeVisible()

  const bucket = page.getByRole('list').filter({ hasText: '5K test' })
  await expect(bucket.getByRole('listitem')).toHaveText([
    /^Threshold.*Week\s1\s·\sLate.*Next$/,
    /^HYROX.*Week\s1\s·\sLate.*/,
    /^5K test/,
    /^Strength/,
    /^Threshold/,
    /^HYROX/,
    /^Easy run.*Optional$/,
  ])
  // Week 2's own count leaves the Late sessions out.
  await expect(page.getByText('5 Sessions left · 6 days')).toHaveCount(0)
  await expect(page.getByText('4 Sessions left · 6 days')).toBeVisible()
  await expectNoAxeViolations(page)

  // Week 2's HYROX instead, today: the Late sessions stay, still counted.
  await doToday(page, bucket.getByRole('listitem').nth(5).getByRole('button'))
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(/^HYROX/)
  await expect(lateMeta).toHaveCount(0)
  await expect(bucket.getByRole('listitem').first()).toHaveText(/^Threshold.*Week\s1\s·\sLate.*Key$/)
  await expect(page.getByText('2 Sessions behind · Week 1')).toBeVisible()
})
