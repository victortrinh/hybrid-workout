import { expect, test } from '@playwright/test'
import { expectNoAxeViolations, WEEK_3 } from './axe'
import { caughtUp, serveHistory, weekDone } from './history'

const WEEK_2 = weekDone(2, ['hyrox-a', 'hyrox-b', 'compromised-run-test', 'strength'], '2026-11-16')

test('a Session tapped on Today opens its Prescription; Do it today instead makes it Up next', async ({ page }) => {
  await serveHistory(page, caughtUp(1, WEEK_2))
  await page.clock.setFixedTime(WEEK_3)
  await page.goto('/')

  const upNext = page.getByRole('heading', { level: 1 })
  const bucket = page.getByRole('list').filter({ hasText: 'Strength' })
  await expect(upNext).toHaveText(/^HYROX A, /)
  await expect(page.getByText(/^Tap any Session/)).toHaveCount(0)

  await expect(bucket.getByRole('button', { name: /^Run/ })).toHaveCount(1)
  await bucket.getByRole('button', { name: /^Run/ }).click()
  const sheet = page.getByRole('dialog', { name: 'Run, 3 × 8′' })
  await expect(sheet).toBeVisible()
  await expect(sheet.getByRole('heading', { name: 'Warm-up' })).toBeVisible()
  await expect(sheet.getByRole('listitem').filter({ hasText: /^Threshold reps/ })).toContainText('Threshold effort, RPE 6–7')
  // Opening it chose nothing.
  await expect(upNext).toHaveText(/^HYROX A, /)
  await expectNoAxeViolations(page)

  // Back closes the sheet and stays on Today.
  await page.goBack()
  await expect(sheet).toHaveCount(0)
  await expect(page).toHaveURL('/')
  await expect(upNext).toHaveText(/^HYROX A, /)

  await expect(bucket.getByRole('button', { name: /^Run/ })).toHaveCount(1)
  await bucket.getByRole('button', { name: /^Run/ }).click()
  await sheet.getByRole('button', { name: 'Do it today instead' }).click()
  await expect(sheet).toHaveCount(0)
  await expect(upNext).toHaveText('Run, 3 × 8′')
  await expect(upNext).toBeFocused()
  await expect(bucket.getByRole('listitem')).toHaveText([/^HYROX A/, /^HYROX B/, /^Run.*Next$/, /^Strength/, /^Easy run/])

  // The sheet's history entry went with it: Back now leaves Today as it would have.
  await expect(page).toHaveURL('/')
})

test('Up next’s Prescription opens with nothing to pick, and Escape closes it', async ({ page }) => {
  await serveHistory(page, caughtUp(1, WEEK_2))
  await page.clock.setFixedTime(WEEK_3)
  await page.goto('/')

  await page.getByRole('button', { name: 'Show the Prescription' }).click()
  const sheet = page.getByRole('dialog', { name: /^HYROX A, / })
  await expect(sheet).toBeVisible()
  await expect(sheet.getByRole('button')).toHaveText(['Close'])
  await page.keyboard.press('Escape')
  await expect(sheet).toHaveCount(0)

  // The Next row opens the same sheet.
  await expect(page.getByRole('list').filter({ hasText: 'Strength' }).getByRole('button', { name: /^HYROX A/ })).toHaveCount(1)
  await page.getByRole('list').filter({ hasText: 'Strength' }).getByRole('button', { name: /^HYROX A/ }).click()
  await expect(sheet).toBeVisible()
  await sheet.getByRole('button', { name: 'Close' }).click()
  await expect(sheet).toHaveCount(0)
  await expect(page).toHaveURL('/')
})

test('while a Live session runs, a Session’s sheet says to finish it first', async ({ page }) => {
  await serveHistory(page, caughtUp(1, WEEK_2))
  await page.clock.install({ time: WEEK_3 })
  await page.goto('/')
  await page.getByRole('button', { name: 'Start HYROX A' }).click()
  await expect(page).toHaveURL('/live')

  await page.goto('/')
  await expect(page.getByRole('list').filter({ hasText: 'Strength' }).getByRole('button', { name: /^Run/ })).toHaveCount(1)
  await page.getByRole('list').filter({ hasText: 'Strength' }).getByRole('button', { name: /^Run/ }).click()
  const sheet = page.getByRole('dialog', { name: /^Run/ })
  await expect(sheet.getByText(/^HYROX A, .+ is running\. Finish it first\.$/)).toBeVisible()
  await expect(sheet.getByRole('button', { name: /^Do it today/ })).toHaveCount(0)
})

test('a logged Session still opens its log', async ({ page }) => {
  await serveHistory(page, caughtUp(1, [...WEEK_2, ...weekDone(3, ['hyrox-a'], '2026-11-23')]))
  await page.clock.setFixedTime(WEEK_3)
  await page.goto('/')

  await expect(page.getByRole('list').filter({ hasText: 'Strength' }).getByRole('link', { name: /^HYROX A/ })).toHaveCount(1)
  await page.getByRole('list').filter({ hasText: 'Strength' }).getByRole('link', { name: /^HYROX A/ }).click()
  await expect(page).toHaveURL('/log/3/hyrox-a')
})
