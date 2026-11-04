import { expect, test } from '@playwright/test'
import { expectNoAxeViolations } from './axe'
import { caughtUp, serveHistory } from './history'
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

/** Monday 22 March 2027: Week 22, the first day of Race specific. */
const RACE_SPECIFIC_MONDAY = new Date('2027-03-22T12:00:00-04:00')

/**
 * Race day doesn't move (ADR-0007): on the first Monday of Race specific the
 * Sessions still Late are dropped, said once, and Up next is Week 22's.
 */
test('drops what is still Late as Race specific starts, and says so once', async ({ page }) => {
  // Week 20's Threshold and Race simulation and Week 21's HYROX never logged.
  const decisions: Record<string, unknown>[] = []
  await serveHistory(
    page,
    caughtUp(19, [
      { week: 20, sessionId: 'speed', date: '2027-03-08', status: 'done' },
      { week: 20, sessionId: 'strength', date: '2027-03-10', status: 'done' },
      ...['speed', 'strength', 'easy-deload'].map((sessionId) => ({
        week: 21,
        sessionId,
        date: '2027-03-16',
        status: 'done' as const,
      })),
    ]),
    [],
    { suggestionDecisions: decisions },
  )
  await page.clock.setFixedTime(RACE_SPECIFIC_MONDAY)
  await page.goto('/')

  const notice = page.getByText('3 Sessions from Weeks 20–21 dropped to keep Race specific on schedule.')
  await expect(notice).toBeVisible()
  await expect(page.getByText(/Sessions? behind/)).toHaveCount(0)
  await expect(page.locator('p', { hasText: /· Late/ })).toHaveCount(0)
  const bucket = page.getByRole('list').filter({ hasText: 'Strength' })
  await expect(bucket.getByRole('listitem').first()).toHaveText(/^Speed.*Next$/)
  await expectNoAxeViolations(page)

  await page.getByRole('button', { name: 'Got it' }).click()
  await expect(notice).toHaveCount(0)
  await page.reload()
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  await expect(notice).toHaveCount(0)
})
