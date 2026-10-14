import { expect, test } from '@playwright/test'
import { expectNoAxeViolations } from './axe'

/**
 * Logs a 5K test to the shared e2e database. Paces come from the latest test
 * on or before today, so each project takes a 5K test Week no other test
 * reaches: the phone Week 17, desktop Week 25. Thursday, so last Week's Key
 * session has stopped carrying over and the 5K test is Up next.
 */
const WEEK = { phone: 17, desktop: 25 } as Record<string, number>
/** Thursday noon in Toronto of Week 17 (Mon 8 Feb) or Week 25 (Mon 5 Apr). */
const THURSDAY = { 17: new Date('2027-02-11T12:00:00-05:00'), 25: new Date('2027-04-08T12:00:00-04:00') } as Record<
  number,
  Date
>

test('logging a 23:00 5K test sets Threshold’s speed, and mph updates every speed', async ({ page }, testInfo) => {
  const week = WEEK[testInfo.project.name]
  await page.clock.setFixedTime(THURSDAY[week])
  await page.goto('/')

  const upNext = page.getByRole('heading', { level: 1 })
  const bucket = page.getByRole('list').filter({ hasText: 'Strength' })
  await expect(upNext).toHaveText(/^5K test, /)

  await page.getByRole('link', { name: 'Log it after instead' }).click()
  await expect(page).toHaveURL(`/log/${week}/5k-test`)
  const time = page.getByRole('textbox', { name: '5 km time' })
  await expect(time).toBeVisible()
  await page.getByRole('radio', { name: 'Indoor' }).check({ force: true })

  // A time that isn't mm:ss stops the save and says why.
  await time.fill('23')
  await page.getByRole('button', { name: 'Save log' }).click()
  await expect(page).toHaveURL(`/log/${week}/5k-test`)
  await expect(page.getByText('Minutes and seconds, like 23:00. That isn’t a time.')).toBeVisible()
  await expectNoAxeViolations(page)

  await time.fill('23:00')
  await page.getByRole('button', { name: 'Save log' }).click()
  await expect(page).toHaveURL('/')

  // Threshold now has an exact treadmill speed: 4:52/km is 12.3 km/h.
  await bucket.getByRole('button', { name: /^Threshold/ }).click()
  await expect(upNext).toHaveText(/^Threshold, /)
  const target = upNext.locator('xpath=following-sibling::p[1]')
  // February runs indoors by default, April outdoors: start both on the treadmill.
  await page.getByRole('radio', { name: 'Indoor' }).check({ force: true })
  await expect(target).toHaveText(/^12\.3 km\/h · 1% incline/)

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
  await expect(target).toHaveText(/^7\.7 mph · 1% incline/)

  await page.goto(`/plan/week/${week}`)
  const main = page.getByRole('main')
  await expect(main.getByText(/Paces from the 23:00 5K test/)).toBeVisible()
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
