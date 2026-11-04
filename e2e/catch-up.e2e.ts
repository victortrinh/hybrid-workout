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

/**
 * A watch run on the Week 2 Tuesday fits both Week 1's Late Threshold and
 * Week 2's own: Today asks, naming each with its Week, and the answer
 * attaches it to the Late row.
 */
test('asks which Week’s Session a watch workout was when it fits a Late one and a current one', async ({ page }) => {
  const activityAnswers: Record<string, unknown>[] = []
  await serveHistory(
    page,
    [
      ...['speed', 'strength', 'hyrox'].map((sessionId) => ({ week: 1, sessionId, date: '2026-10-27', status: 'done' as const })),
      ...['5k-test', 'easy'].map((sessionId) => ({ week: 2, sessionId, date: '2026-11-02', status: 'done' as const })),
    ],
    [],
    {
      activities: [
        {
          id: '2026-11-03T12:00:00Z',
          date: '2026-11-03',
          startedAt: '2026-11-03T12:00:00Z',
          workoutType: 'Running',
          kind: 'run',
          minutes: 40,
          distanceMeters: 8000,
          averageHeartRate: null,
          maxHeartRate: null,
          indoor: false,
          receivedAt: '2026-11-03T13:00:00.000Z',
        },
      ],
      activityAnswers,
    },
  )
  await page.clock.setFixedTime(WEEK_2_TUESDAY)
  await page.goto('/')

  const question = page.getByRole('region', { name: 'Which Session was this?' })
  await expect(question.getByRole('button')).toHaveText(['Threshold · Week 1', 'Threshold · Week 2', 'None of these'])
  await expectNoAxeViolations(page)

  await question.getByRole('button', { name: 'Threshold · Week 1' }).click()
  await expect(question).toHaveCount(0)
  await expect.poll(() => activityAnswers.at(-1)).toMatchObject({ week: 1, sessionId: 'threshold' })
  await expect(page.getByRole('region', { name: 'From the watch' })).toContainText('Threshold it was. Not logged yet.')
  const bucket = page.getByRole('list').filter({ hasText: '5K test' })
  await expect(bucket.getByRole('listitem').first()).toHaveText(/^Threshold.*Week\s1\s·\sLate.*Watch/)
})
