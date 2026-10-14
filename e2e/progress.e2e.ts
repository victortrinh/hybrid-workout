import { expect, test } from '@playwright/test'
import { expectNoAxeViolations, WEEK_3 } from './axe'
import { serveHistory, type SeedLog } from './history'

/** Week 1 mostly done, a 23:00 treadmill baseline in Week 2: the prototype's Wednesday of Week 3. */
const HISTORY: SeedLog[] = [
  { week: 1, sessionId: 'speed', date: '2026-10-19', status: 'done', rpe: 7 },
  { week: 1, sessionId: 'strength', date: '2026-10-20', status: 'done' },
  { week: 1, sessionId: 'threshold', date: '2026-10-22', status: 'partial' },
  { week: 1, sessionId: 'hyrox', date: '2026-10-24', status: 'done', minutes: 60, rpe: 7 },
  { week: 2, sessionId: '5k-test', date: '2026-10-28', status: 'done', rpe: 9, resultSeconds: 1380, environment: 'indoor' },
  { week: 2, sessionId: 'strength', date: '2026-10-29', status: 'done' },
  { week: 2, sessionId: 'threshold', date: '2026-10-31', status: 'skipped' },
  { week: 3, sessionId: 'speed', date: '2026-11-02', status: 'done', rpe: 7 },
]

test.beforeEach(async ({ page }) => {
  await serveHistory(page, HISTORY)
  await page.clock.setFixedTime(WEEK_3)
})

for (const colorScheme of ['light', 'dark'] as const) {
  test(`every Progress panel renders from the history, ${colorScheme}`, async ({ page }) => {
    await page.emulateMedia({ colorScheme })
    await page.goto('/progress')
    const main = page.getByRole('main')

    for (const name of ['5K vs. sub-20', 'Weekly completion', 'Training load', 'Training paces']) {
      await expect(main.getByRole('heading', { level: 2, name })).toBeVisible()
    }

    // The 5K test against the planned line to 20:00 by Week 25.
    const fiveK = page.getByRole('img', { name: /^5K tests:/ })
    await expect(fiveK).toHaveAccessibleName(
      '5K tests: 23:00 in Week 2 treadmill. Planned line from 23:00 to 20:00 by Week 25. Tests to come in Weeks 9, 17 and 25.',
    )
    await expect(main.getByText('One test so far: latest 23:00 on a treadmill, Week 2. 3:00 to find by Week 25.')).toBeVisible()

    // Weekly completion: Foundation so far, one row per Week, linking to it.
    const completion = main.getByRole('region', { name: 'Weekly completion' })
    await expect(completion.getByRole('link')).toHaveCount(3)
    await expect(completion.getByRole('link', { name: /^Week 1: 4 of 4 done/ })).toBeVisible()
    await expect(completion.getByRole('link', { name: /^Week 2: 2 of 4 done, 2 missed, 5K test/ })).toBeVisible()
    await expect(completion.getByRole('link', { name: /^Week 3, this Week: 1 of 4 done/ })).toHaveAttribute(
      'aria-current',
      'date',
    )

    // Training load: RPE × minutes. Week 1: 7×45 + 6×45 + 6×45 + 7×60 = 1275.
    await expect(page.getByRole('img', { name: /^Training load:/ })).toHaveAccessibleName(
      'Training load: Week 1 1275, Week 2 675, Week 3 so far 315',
    )

    // Training paces from the 23:00 test, in km/h by default.
    const paces = main.getByRole('table')
    await expect(paces.getByRole('columnheader')).toHaveText(['Pace', 'min/km', 'km/h'])
    await expect(paces.getByRole('row', { name: /^Goal/ })).toHaveText(/4:0015\.0/)
    await expect(paces.getByRole('row', { name: /^Threshold/ })).toHaveText(/4:5212\.3/)

    // Both charts draw at the full width of their panel.
    for (const chart of [fiveK, page.getByRole('img', { name: /^Training load:/ })]) {
      const svg = (await chart.boundingBox())!
      const slot = (await chart.locator('xpath=..').boundingBox())!
      expect(Math.abs(svg.width - slot.width)).toBeLessThanOrEqual(1)
    }

    await expectNoAxeViolations(page)
  })
}

test('desktop lays the panels on twelve columns; a phone stacks them', async ({ page }, testInfo) => {
  await page.goto('/progress')
  const box = async (name: string) => (await page.getByRole('region', { name }).boundingBox())!
  const fiveK = await box('5K vs. sub-20')
  const completion = await box('Weekly completion')
  if (testInfo.project.name === 'desktop') {
    // Eight columns beside four, on one row.
    expect(completion.y).toBeCloseTo(fiveK.y, 0)
    expect(fiveK.width / completion.width).toBeGreaterThan(1.8)
  } else {
    expect(completion.y).toBeGreaterThan(fiveK.y + fiveK.height - 1)
    expect(completion.width).toBeCloseTo(fiveK.width, 0)
  }
})

test('the paces table follows the speed unit', async ({ page }) => {
  await page.addInitScript(() =>
    localStorage.setItem('compromised:settings', JSON.stringify({ unit: 'mph', theme: 'system' })),
  )
  await page.goto('/progress')
  const paces = page.getByRole('table')
  await expect(paces.getByRole('columnheader')).toHaveText(['Pace', 'min/km', 'mph'])
  await expect(paces.getByRole('row', { name: /^Threshold/ })).toHaveText(/4:527\.7/)
})
