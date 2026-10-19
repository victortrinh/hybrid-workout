import { expect, test } from '@playwright/test'
import { expectNoAxeViolations, WEEK_3 } from './axe'

const PHASES = ['Foundation', '5K development', 'HYROX build', 'Race specific', 'Taper']

for (const colorScheme of ['light', 'dark'] as const) {
  test.describe(`Plan, ${colorScheme}`, () => {
    test.use({ colorScheme })

    test.beforeEach(async ({ page }) => {
      await page.clock.setFixedTime(WEEK_3)
    })

    test('shows all 26 Weeks grouped by Phase, marked, with this Week highlighted', async ({ page }) => {
      await page.goto('/plan')

      await expect(page.getByRole('heading', { level: 2 })).toHaveText(PHASES.map((p) => new RegExp(`^${p}`)))
      const weeks = page.getByRole('link', { name: /^Week \d+, from/ })
      await expect(weeks).toHaveCount(26)

      await expect(page.getByRole('link', { name: /^Week 3, from Mon 9 Nov, this Week/ })).toHaveAttribute(
        'aria-current',
        'date',
      )
      await expect(page.locator('[aria-current="date"]')).toHaveCount(1)

      const mark = (n: number) => page.getByRole('link', { name: new RegExp(`^Week ${n}, from`) })
      for (const n of [7, 11, 15, 21]) await expect(mark(n)).toContainText('Deload')
      for (const n of [2, 8, 16, 24]) await expect(mark(n)).toContainText('5K test')
      for (const n of [17, 20, 23]) await expect(mark(n)).toContainText('Simulation')
      await expect(mark(26)).toContainText('Race')

      await expectNoAxeViolations(page)
    })

    test('tapping a Week lists its Sessions and Prescriptions', async ({ page }) => {
      await page.goto('/plan')
      await page.getByRole('link', { name: /^Week 23, from/ }).click()

      await expect(page).toHaveURL('/plan/week/23')
      await expect(page).toHaveTitle('Week 23 · Compromised')
      await expect(page.getByRole('heading', { level: 1, name: 'Week 23' })).toBeFocused()
      await expect(page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Plan' })).toHaveAttribute(
        'aria-current',
        'page',
      )
      await expect(page.getByRole('heading', { level: 2 })).toHaveText([
        'Speed, 4 × 3′',
        'Strength, squat 2 × 4',
        'Threshold, 2 × 10′',
        'Race simulation, full run',
        'Easy run, 45′',
      ])
      // Prescriptions open one tap away.
      const simulation = page.getByRole('region', { name: 'Race simulation, full run' })
      await expect(simulation.getByText('Sled push · 25 m · 335 lb plates')).toBeHidden()
      await simulation.getByRole('button', { name: 'Show the Prescription' }).click()
      await expect(simulation.getByRole('button', { name: 'Hide the Prescription' })).toHaveAttribute('aria-expanded', 'true')
      await expect(page.getByText('Sled push · 25 m · 335 lb plates')).toBeVisible()
      await expect(page.getByText('Farmers carry · 100 m · 2 × 55 lb')).toBeVisible()
      await expectNoAxeViolations(page)

      await page.getByRole('link', { name: 'Week 24 →' }).click()
      await expect(page.getByRole('heading', { level: 1, name: 'Week 24' })).toBeFocused()
      await page.getByRole('link', { name: '← Plan' }).click()
      await expect(page).toHaveURL('/plan')
    })
  })
}

test('Race week loads from a deep link, and unknown Weeks say so', async ({ page }) => {
  await page.clock.setFixedTime(WEEK_3)
  await page.goto('/plan/week/26')
  await expect(page.getByRole('heading', { level: 1, name: 'Week 26' })).toBeVisible()
  await expect(page.getByRole('heading', { level: 2, name: 'HYROX, race day' })).toBeVisible()
  await expect(page.getByText('Tuesday: rest.', { exact: false })).toBeVisible()

  await page.goto('/plan/week/27')
  await expect(page.getByRole('heading', { level: 1, name: 'Nothing here.' })).toBeVisible()
})

test('Plan opens on the current Week, a third of the way down, within the thumb’s reach', async ({ page }) => {
  // Wednesday of Week 15: far enough down the list that the top of Plan would hide it.
  await page.clock.setFixedTime(new Date('2027-02-03T12:00:00-05:00'))
  await page.goto('/plan')
  const current = page.locator('[aria-current="date"]')
  await expect(current).toHaveAccessibleName(/^Week 15, from/)
  const box = (await current.boundingBox())!
  const height = page.viewportSize()!.height
  expect(box.y).toBeGreaterThan(height * 0.2)
  expect(box.y + box.height).toBeLessThan(height * 0.6)
})
