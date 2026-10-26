import { expect, test, type Page } from '@playwright/test'
import { expectNoAxeViolations, WEEK_3 } from './axe'
import { serveHistory, weekDone } from './history'
import { aMinuteBefore, doToday, startAsChosen } from './today'

/**
 * Lock-screen cues (ADR-0006). The browser here has no push service, so the
 * server's cue timer is stood in for: the tests check what the page says in
 * Settings and what it hands the server as the app goes off screen.
 */

const WEEK_2 = [
  { week: 2, sessionId: '5k-test', date: '2026-11-03', status: 'done', resultSeconds: 23 * 60, environment: 'indoor' },
  ...weekDone(2, ['strength', 'threshold', 'hyrox'], '2026-11-04'),
] as const

/** The cue timer's answer to GET /api/cues. */
const serveKey = (page: Page, key: string | null) =>
  page.route('/api/cues', (route) => route.fulfill({ json: { key, subscribed: false } }))

/** The app going off screen, or coming back: what iOS does when another app opens or the phone locks. */
const setVisibility = (page: Page, state: 'hidden' | 'visible') =>
  page.evaluate((state) => {
    Object.defineProperty(document, 'visibilityState', { value: state, configurable: true })
    document.dispatchEvent(new Event('visibilitychange'))
  }, state)

test('Settings offers lock-screen cues once the server is set up, and says so until then', async ({ page }) => {
  // A phone that allowed notifications: CI's headless Chromium always says denied, whatever is granted.
  await page.addInitScript(() => Object.defineProperty(Notification, 'permission', { get: () => 'granted' }))
  await page.clock.setFixedTime(WEEK_3)
  await serveKey(page, null)
  await page.goto('/')
  await page.getByRole('button', { name: 'Settings' }).click()
  const settings = page.getByRole('dialog', { name: 'Settings' })
  await expect(settings.getByText('Lock-screen cues')).toBeVisible()
  await expect(settings.getByText('Not set up on the server yet.')).toBeVisible()
  await expect(settings.getByRole('button', { name: 'Turn on' })).toHaveCount(0)

  await page.unroute('/api/cues')
  await serveKey(page, 'BOr…key')
  await page.reload()
  await page.getByRole('button', { name: 'Settings' }).click()
  await expect(settings.getByRole('button', { name: 'Turn on' })).toBeVisible()
  await expect(settings.getByText(/while the app is off screen/)).toBeVisible()
  await expectNoAxeViolations(page)
})

test('a Live session hands its cues to the server as the app goes off screen, and takes them back on return', async ({
  page,
}) => {
  await serveHistory(page, [...WEEK_2])
  const schedules: { cues: { at: number; title: string; body: string }[] }[] = []
  await page.route('/api/cues/schedule', (route) => {
    schedules.push(route.request().postDataJSON())
    return route.fulfill({ status: 204 })
  })
  await page.addInitScript(() => localStorage.setItem('compromised:lock-screen-cues', 'on'))
  const start = new Date(WEEK_3.getTime() + 1000)
  await page.clock.install({ time: aMinuteBefore(WEEK_3) })
  await page.goto('/')
  await doToday(page, page.getByRole('list').filter({ hasText: 'Strength' }).getByRole('button', { name: /^Threshold/ }))
  await page.clock.pauseAt(start)
  await page.getByRole('button', { name: /^Start / }).click()
  await startAsChosen(page)
  await expect(page).toHaveURL('/live')
  await page.clock.runFor('02:00')

  await setVisibility(page, 'hidden')
  await expect.poll(() => schedules.length).toBeGreaterThan(0)
  // The warm-up's end, then the clock holds on Ready: that's as far as it can say.
  expect(schedules.at(-1)!.cues).toEqual([
    { at: start.getTime() + 10 * 60_000, title: 'Rep 1 of 2 next', body: 'Open the app and tap Start.' },
  ])

  const sent = schedules.length
  await setVisibility(page, 'visible')
  await expect.poll(() => schedules.length).toBeGreaterThan(sent)
  expect(schedules.at(-1)!.cues).toEqual([])
})

test('nothing goes to the server while lock-screen cues are off', async ({ page }) => {
  await serveHistory(page, [...WEEK_2])
  let calls = 0
  await page.route('/api/cues/schedule', (route) => {
    calls += 1
    return route.fulfill({ status: 204 })
  })
  await page.clock.install({ time: aMinuteBefore(WEEK_3) })
  await page.goto('/')
  await doToday(page, page.getByRole('list').filter({ hasText: 'Strength' }).getByRole('button', { name: /^Threshold/ }))
  await page.clock.pauseAt(new Date(WEEK_3.getTime() + 1000))
  await page.getByRole('button', { name: /^Start / }).click()
  await startAsChosen(page)
  await expect(page).toHaveURL('/live')
  await setVisibility(page, 'hidden')
  await setVisibility(page, 'visible')
  await page.waitForTimeout(300)
  expect(calls).toBe(0)
})
