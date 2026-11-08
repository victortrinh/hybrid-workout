import { expect, test } from '@playwright/test'
import { BEFORE_WEEK_1, expectNoAxeViolations, WEEK_3 } from './axe'
import { serveHistory, weekDone } from './history'
import { startAsChosen } from './today'

/** A Session from another Week, started or logged today, still counts for its own Week. */

const BUCKET = ['hyrox-a', 'hyrox-b', 'run', 'strength']

test('before the Program, a Week 1 Session is logged early from its Week', async ({ page }) => {
  const sent = await serveHistory(page, [])
  await page.clock.setFixedTime(BEFORE_WEEK_1)
  await page.goto('/')

  await page.getByRole('link', { name: 'Can’t wait? Start a Week 1 Session early' }).click()
  await expect(page).toHaveURL('/plan/week/1')
  await expect(page.getByText('Early. Week 1 starts Mon 9 Nov. Anything done today counts for Week 1.')).toBeVisible()
  const session = page.getByRole('region', { name: /^HYROX A/ })
  await expect(session.getByRole('button', { name: 'Start session' })).toBeVisible()
  await expectNoAxeViolations(page)

  await session.getByRole('link', { name: 'Log after' }).click()
  await expect(page).toHaveURL('/log/1/hyrox-a')
  // None of Week 1's days has come: today is the only day there is.
  await expect(page.getByRole('radio', { name: 'Mon 9 November' })).toHaveCount(0)
  await expect(page.getByRole('radio', { name: 'Today, Tue 3 November' })).toBeChecked()
  await expectNoAxeViolations(page)

  await page.getByRole('button', { name: 'Save log' }).click()
  await expect(page).toHaveURL('/plan/week/1')
  await expect(session).toContainText('Done, Tue 3 Nov')
  await expect(session.getByRole('button', { name: 'Start session' })).toHaveCount(0)
  await expect(session.getByRole('link', { name: 'Edit log' })).toBeVisible()
  expect(sent.at(-1)).toMatchObject({ week: 1, sessionId: 'hyrox-a', date: '2026-11-03', status: 'done' })
})

test('before the Program, a Week 1 Session tapped on Today is started early from there', async ({ page }) => {
  await serveHistory(page, [])
  await page.clock.setFixedTime(BEFORE_WEEK_1)
  await page.goto('/')

  await page.getByRole('button', { name: /^Run/ }).click()
  await page.getByRole('button', { name: /^Do it today/ }).click()
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(/^Run/)
  await expect(page.getByText('Early. Week 1 starts Mon 9 Nov. Anything done today counts for Week 1.')).toBeVisible()
  await expect(page.getByRole('link', { name: /Start a Week 1 Session early/ })).toHaveCount(0)
  await expectNoAxeViolations(page)

  await page.getByRole('button', { name: /^Start / }).click()
  await startAsChosen(page)
  await expect(page).toHaveURL('/live')
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(/^Run, /)
})

test('in Week 3, a Week 1 Session never done is started late from its Week', async ({ page }) => {
  await serveHistory(page, weekDone(2, ['hyrox-a', 'hyrox-b', 'compromised-run-test', 'strength'], '2026-11-18'))
  await page.clock.setFixedTime(WEEK_3)
  await page.goto('/plan/week/1')

  await expect(page.getByText('Late. Week 1 closed Sun 15 Nov.')).toBeVisible()
  const session = page.getByRole('region', { name: /^Run/ })
  await expectNoAxeViolations(page)

  // Nothing hurts on record: Start asks only where, then it's the Live session.
  await session.getByRole('button', { name: 'Start session' }).click()
  await startAsChosen(page, session)
  await expect(page).toHaveURL('/live')
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(/^Run, /)
})

test('with Week 1 all logged before it starts, Today points to Week 2', async ({ page }) => {
  await serveHistory(page, weekDone(1, [...BUCKET, 'easy'], '2026-11-03'))
  await page.clock.setFixedTime(BEFORE_WEEK_1)
  await page.goto('/')

  await page.getByRole('link', { name: 'Can’t wait? Start a Week 2 Session early' }).click()
  await expect(page).toHaveURL('/plan/week/2')
  await expect(page.getByText('Early. Week 2 starts Mon 16 Nov.')).toBeVisible()
})

test('once Week 1 is done, Today points to Week 2', async ({ page }) => {
  await serveHistory(page, weekDone(1, [...BUCKET, 'easy'], '2026-11-10'))
  await page.clock.setFixedTime(new Date('2026-11-12T12:00:00-05:00'))
  await page.goto('/')

  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Week done.')
  await page.getByRole('link', { name: 'Can’t wait? Start a Week 2 Session early' }).click()
  await expect(page).toHaveURL('/plan/week/2')
  await expectNoAxeViolations(page)
})
