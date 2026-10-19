import { expect, test } from '@playwright/test'
import { expectNoAxeViolations, WEEK_3 } from './axe'
import { serveHistory, weekDone } from './history'

const WEEK_2 = weekDone(2, ['5k-test', 'strength', 'threshold', 'hyrox'], '2026-11-02')

test('a Session tapped on Today opens its Prescription; Do it today instead makes it Up next', async ({ page }) => {
  await serveHistory(page, WEEK_2)
  await page.clock.setFixedTime(WEEK_3)
  await page.goto('/')

  const upNext = page.getByRole('heading', { level: 1 })
  const bucket = page.getByRole('list').filter({ hasText: 'Strength' })
  await expect(upNext).toHaveText(/^Speed, /)
  await expect(page.getByText(/^Tap any Session/)).toHaveCount(0)

  await bucket.getByRole('button', { name: /^Threshold/ }).click()
  const sheet = page.getByRole('dialog', { name: 'Threshold, 2 × 12′' })
  await expect(sheet).toBeVisible()
  await expect(sheet.getByRole('heading', { name: 'Warm-up' })).toBeVisible()
  await expect(sheet.getByRole('listitem').filter({ hasText: /^Threshold reps/ })).toContainText('Threshold effort, RPE 6–7')
  // Opening it chose nothing.
  await expect(upNext).toHaveText(/^Speed, /)
  await expectNoAxeViolations(page)

  // Back closes the sheet and stays on Today.
  await page.goBack()
  await expect(sheet).toHaveCount(0)
  await expect(page).toHaveURL('/')
  await expect(upNext).toHaveText(/^Speed, /)

  await bucket.getByRole('button', { name: /^Threshold/ }).click()
  await sheet.getByRole('button', { name: 'Do it today instead' }).click()
  await expect(sheet).toHaveCount(0)
  await expect(upNext).toHaveText('Threshold, 2 × 12′')
  await expect(upNext).toBeFocused()
  await expect(bucket.getByRole('listitem')).toHaveText([/^Speed/, /^Strength/, /^Threshold.*Next$/, /^HYROX/, /^Easy run/])

  // The sheet's history entry went with it: Back now leaves Today as it would have.
  await expect(page).toHaveURL('/')
})

test('Up next’s Prescription opens with nothing to pick, and Escape closes it', async ({ page }) => {
  await serveHistory(page, WEEK_2)
  await page.clock.setFixedTime(WEEK_3)
  await page.goto('/')

  await page.getByRole('button', { name: 'Show the Prescription' }).click()
  const sheet = page.getByRole('dialog', { name: /^Speed, / })
  await expect(sheet).toBeVisible()
  await expect(sheet.getByRole('button')).toHaveText(['Close'])
  await page.keyboard.press('Escape')
  await expect(sheet).toHaveCount(0)

  // The Next row opens the same sheet.
  await page.getByRole('list').filter({ hasText: 'Strength' }).getByRole('button', { name: /^Speed/ }).click()
  await expect(sheet).toBeVisible()
  await sheet.getByRole('button', { name: 'Close' }).click()
  await expect(sheet).toHaveCount(0)
  await expect(page).toHaveURL('/')
})

test('while a Live session runs, a Session’s sheet says to finish it first', async ({ page }) => {
  await serveHistory(page, WEEK_2)
  await page.clock.install({ time: WEEK_3 })
  await page.goto('/')
  await page.getByRole('button', { name: /^Start / }).click()
  await expect(page).toHaveURL('/live')

  await page.goto('/')
  await page.getByRole('list').filter({ hasText: 'Strength' }).getByRole('button', { name: /^Threshold/ }).click()
  const sheet = page.getByRole('dialog', { name: /^Threshold/ })
  await expect(sheet.getByText(/^Speed, .+ is running\. Finish it first\.$/)).toBeVisible()
  await expect(sheet.getByRole('button', { name: /^Do it today/ })).toHaveCount(0)
})

test('a logged Session still opens its log', async ({ page }) => {
  await serveHistory(page, [...WEEK_2, ...weekDone(3, ['speed'], '2026-11-09')])
  await page.clock.setFixedTime(WEEK_3)
  await page.goto('/')

  await page.getByRole('list').filter({ hasText: 'Strength' }).getByRole('link', { name: /^Speed/ }).click()
  await expect(page).toHaveURL('/log/3/speed')
})
