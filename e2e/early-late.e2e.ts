import { expect, test } from '@playwright/test'
import { BEFORE_WEEK_1, expectNoAxeViolations, WEEK_3 } from './axe'
import { serveHistory, weekDone } from './history'

/** A Session from another Week, started or logged today, still counts for its own Week. */

test('before the Program, a Week 1 Session is logged early from its Week', async ({ page }) => {
  const sent = await serveHistory(page, [])
  await page.clock.setFixedTime(BEFORE_WEEK_1)
  await page.goto('/')

  await page.getByRole('link', { name: 'Can’t wait? Start a Week 1 Session early' }).click()
  await expect(page).toHaveURL('/plan/week/1')
  await expect(page.getByText('Early. Week 1 starts Mon 19 Oct. Anything done today counts for Week 1.')).toBeVisible()
  const speed = page.getByRole('region', { name: /^Speed/ })
  await expect(speed.getByRole('button', { name: 'Start session' })).toBeVisible()
  await expectNoAxeViolations(page)

  await speed.getByRole('link', { name: 'Log after' }).click()
  await expect(page).toHaveURL('/log/1/speed')
  // None of Week 1's days has come: today is the only day there is.
  await expect(page.getByRole('radio', { name: 'Mon 19 October' })).toHaveCount(0)
  await expect(page.getByRole('radio', { name: 'Today, Tue 13 October' })).toBeChecked()
  await expectNoAxeViolations(page)

  await page.getByRole('button', { name: 'Save log' }).click()
  await expect(page).toHaveURL('/plan/week/1')
  await expect(speed).toContainText('Done, Tue 13 Oct')
  await expect(speed.getByRole('button', { name: 'Start session' })).toHaveCount(0)
  await expect(speed.getByRole('link', { name: 'Edit log' })).toBeVisible()
  expect(sent.at(-1)).toMatchObject({ week: 1, sessionId: 'speed', date: '2026-10-13', status: 'done' })
})

test('in Week 3, a Week 1 Session never done is started late from its Week', async ({ page }) => {
  await serveHistory(page, weekDone(2, ['speed', 'strength', 'threshold', 'hyrox'], '2026-10-28'))
  await page.clock.setFixedTime(WEEK_3)
  await page.goto('/plan/week/1')

  await expect(page.getByText('Late. Week 1 closed Sun 25 Oct.')).toBeVisible()
  const speed = page.getByRole('region', { name: /^Speed/ })
  await speed.getByRole('button', { name: 'Start session' }).click()
  await expect(page.getByRole('heading', { name: 'Anything hurt?' })).toBeVisible()
  await expectNoAxeViolations(page)

  await page.getByRole('button', { name: 'No. Let’s go' }).click()
  await expect(page).toHaveURL('/live')
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(/^Speed, /)
})

test('with Week 1 all logged before it starts, Today points to Week 2', async ({ page }) => {
  await serveHistory(page, weekDone(1, ['speed', 'strength', 'threshold', 'hyrox', 'easy'], '2026-10-13'))
  await page.clock.setFixedTime(BEFORE_WEEK_1)
  await page.goto('/')

  await page.getByRole('link', { name: 'Can’t wait? Start a Week 2 Session early' }).click()
  await expect(page).toHaveURL('/plan/week/2')
  await expect(page.getByText('Early. Week 2 starts Mon 26 Oct.')).toBeVisible()
})

test('once Week 1 is done, Today points to Week 2', async ({ page }) => {
  await serveHistory(page, weekDone(1, ['speed', 'strength', 'threshold', 'hyrox', 'easy'], '2026-10-20'))
  await page.clock.setFixedTime(new Date('2026-10-22T12:00:00-04:00'))
  await page.goto('/')

  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Week done.')
  await page.getByRole('link', { name: 'Can’t wait? Start a Week 2 Session early' }).click()
  await expect(page).toHaveURL('/plan/week/2')
  await expectNoAxeViolations(page)
})
