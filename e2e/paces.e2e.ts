import { expect, test } from '@playwright/test'
import { expectNoAxeViolations, WEEK_3 } from './axe'
import { caughtUp, serveHistory } from './history'


test('a 23:00 estimate sets the Run’s Threshold speed, and mph updates every speed', async ({ page }) => {
  // Training paces come from the Starting point's estimate, kept on this device.
  await page.addInitScript(() =>
    localStorage.setItem(
      'compromised:starting-point',
      JSON.stringify({ point: { fiveKSeconds: 23 * 60, weights: {}, updatedAt: '2026-11-05T12:00:00.000Z' }, pending: false }),
    ),
  )
  await serveHistory(page, caughtUp(2))
  await page.clock.setFixedTime(WEEK_3)
  await page.goto('/')
  const week = 3

  const upNext = page.getByRole('heading', { level: 1 })
  const bucket = page.getByRole('list').filter({ hasText: 'Strength' })
  await expect(upNext).toHaveText(/^HYROX A, /)
  await expectNoAxeViolations(page)

  // The Run's Threshold reps have an exact treadmill speed: 4:52/km is 12.3 km/h.
  await expect(bucket.getByRole('button', { name: /^Run/ })).toHaveCount(1)
  await bucket.getByRole('button', { name: /^Run/ }).click()
  await page.getByRole('button', { name: /^Do it today/ }).click()
  await expect(upNext).toHaveText(/^Run, /)
  const target = upNext.locator('xpath=following-sibling::p[1]')
  // Start on the treadmill, whatever the month's default.
  await page.getByRole('radio', { name: 'Indoor' }).check({ force: true })
  await expect(target).toHaveText(/^12\.3 km\/h · 4:52\/km · 1% incline/)

  // One Session outdoors: pace per km instead.
  await page.getByRole('radio', { name: 'Outdoor' }).check({ force: true })
  await expect(target).toHaveText(/^4:52\/km/)
  await page.getByRole('radio', { name: 'Indoor' }).check({ force: true })
  await expect(target).toHaveText(/^12\.3 km\/h/)

  // Settings: mph changes every speed, on Today and on the Week.
  await page.getByRole('button', { name: 'Settings' }).click()
  const settings = page.getByRole('dialog', { name: 'Settings' })
  await expect(settings).toBeVisible()
  await expectNoAxeViolations(page)
  await settings.getByText('mph', { exact: true }).click()
  await page.keyboard.press('Escape')
  await expect(settings).toBeHidden()
  await expect(target).toHaveText(/^7\.7 mph · 4:52\/km · 1% incline/)

  await page.goto(`/plan/week/${week}`)
  const main = page.getByRole('main')
  await expect(main.getByText('Estimated paces from your Starting point')).toBeVisible()
  await expect(main.getByText(/mph/).first()).toBeVisible()
  await expect(main).not.toContainText('km/h')

  // The choice survives a reload.
  await page.reload()
  await expect(main.getByText(/mph/).first()).toBeVisible()
  await expect(main).not.toContainText('km/h')
})

test('the theme setting overrides the system', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Settings' }).click()
  const settings = page.getByRole('dialog', { name: 'Settings' })
  await settings.getByText('Dark', { exact: true }).click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await page.reload()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await page.getByRole('button', { name: 'Settings' }).click()
  await settings.getByText('System', { exact: true }).click()
  await expect(page.locator('html')).not.toHaveAttribute('data-theme')
})
