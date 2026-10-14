import { expect, test, type Page } from '@playwright/test'
import { expectNoAxeViolations, WEEK_3 } from './axe'
import { serveHistory, weekDone } from './history'

/**
 * Live run sessions under a controlled clock: the page's timers only move
 * when the test runs the clock forward. The server is stood in for, so these
 * write nothing to the shared database; the test reads what the page synced.
 */

/** Week 2 done, with a 23:00 5K test on the treadmill: Threshold is 12.3 km/h. */
const WEEK_2 = [
  { week: 2, sessionId: '5k-test', date: '2026-10-27', status: 'done', resultSeconds: 23 * 60, environment: 'indoor' },
  ...weekDone(2, ['strength', 'threshold', 'hyrox'], '2026-10-28'),
] as const

const live = (page: Page) => {
  const band = page.locator('header')
  return {
    heading: page.getByRole('heading', { level: 1 }),
    block: band.locator('p').first(),
    target: band.locator('.stripe-num'),
    timer: page.getByRole('timer'),
    line: band.locator('[aria-live]'),
    pause: page.getByRole('button', { name: /^(Pause|Resume)$/ }),
    skip: page.getByRole('button', { name: /^(Skip block|Finished 5 km)$/ }),
  }
}

/** axe waits on timers of its own, so the clock runs while it scans, then stops again at `then`. */
async function scan(page: Page, then?: Date) {
  await page.clock.resume()
  await expectNoAxeViolations(page)
  if (then) await page.clock.pauseAt(then)
}

const minutes = (from: Date, m: number) => new Date(from.getTime() + m * 60_000)

test('a full Threshold Session from Start to logged', async ({ page }) => {
  const sent = await serveHistory(page, [...WEEK_2])
  const start = new Date(WEEK_3.getTime() + 1000)
  await page.clock.install({ time: WEEK_3 })
  await page.goto('/')
  await page.clock.pauseAt(start)

  const bucket = page.getByRole('list').filter({ hasText: 'Strength' })
  await bucket.getByRole('button', { name: /^Threshold/ }).click()
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Threshold, 2 × 12′')
  await page.getByRole('button', { name: 'Start session' }).click()

  await expect(page).toHaveURL('/live')
  await expect(page).toHaveTitle('Live session · Compromised')
  const s = live(page)
  await expect(s.heading).toHaveText('Threshold, 2 × 12′')
  await expect(s.heading).toBeFocused()
  await expect(s.block).toHaveText('Warm-up · 10 min')
  await expect(s.timer).toHaveText('10:00')
  await expect(page.getByRole('navigation')).toHaveCount(0)
  const blocks = page.getByRole('list', { name: 'Blocks' }).getByRole('listitem')
  await expect(blocks).toHaveText([
    /^Warm-up\s*10 min$/,
    /^Rep 1 of 2\s*12\.3 km\/h$/,
    /^Jog\s*2 min$/,
    /^Rep 2 of 2\s*12\.3 km\/h$/,
    /^Easy and cooldown\s*9 min$/,
  ])

  // The controls are the same elements all session long: a tick never re-renders them.
  const pauseButton = await s.pause.elementHandle()
  await page.clock.runFor('05:00')
  await expect(s.timer).toHaveText('05:00')

  await s.pause.click()
  await expect(s.pause).toHaveText('Resume')
  await page.clock.runFor('02:00')
  await expect(s.timer).toHaveText('05:00')
  await s.pause.click()
  await expect(s.pause).toHaveText('Pause')

  // Rep 1: the target speed huge, the incline and the time left.
  await page.clock.runFor('05:00')
  await expect(s.block).toHaveText('Rep 1 of 2 · 12 min')
  await expect(s.target).toHaveText('12.3')
  await expect(page.locator('header').getByText('km/h', { exact: true })).toBeVisible()
  await expect(page.locator('header').getByText('1%')).toBeVisible()
  await expect(s.timer).toHaveText('12:00')
  await expect(s.line).toHaveText('Rep 1. Threshold. Do not race it.')
  await expect(blocks.nth(1)).toHaveAttribute('aria-current', 'step')
  // Rep 1 started 12 minutes in (two of them paused); the scan ends 30 seconds into it.
  await scan(page, minutes(start, 12.5))
  await expect(s.timer).toHaveText('11:30')

  // The rep is over: one tap says it was held.
  await page.clock.runFor('11:30')
  await expect(s.block).toHaveText('Jog · 2 min')
  const check = page.getByRole('region', { name: 'Rep 1 of 2: held the target?' })
  await expect(check).toContainText('Rep 1 of 2: held 12.3 km/h?')
  await check.getByRole('button', { name: 'Held it' }).click()
  await expect(check).toBeHidden()

  // Rep 2 drifted: Changed, with the speed actually run.
  await page.clock.runFor('14:00')
  await expect(s.block).toHaveText('Easy and cooldown · 9 min')
  const second = page.getByRole('region', { name: 'Rep 2 of 2: held the target?' })
  await second.getByRole('button', { name: 'Changed' }).click()
  await second.getByRole('textbox', { name: 'Actual speed, km/h' }).fill('12.1')
  await second.getByRole('button', { name: 'Save' }).click()
  await expect(second).toBeHidden()
  expect(await s.pause.evaluate((el, before) => el === before, pauseButton)).toBe(true)

  // Away to Today and back, a reload each way: the session is still running, where it was.
  await page.clock.runFor('01:00')
  await page.goto('/')
  await page.getByRole('link', { name: 'Resume Threshold, 2 × 12′' }).click()
  await expect(page).toHaveURL('/live')
  await page.reload()
  await expect(s.block).toHaveText('Easy and cooldown · 9 min')
  await expect(s.timer).toHaveText('08:00')

  // The last Block ends on the finish sheet.
  await page.clock.runFor('08:00')
  await expect(page.getByText('Session over')).toBeVisible()
  await expect(s.pause).toHaveCount(0)
  await page.getByRole('textbox', { name: 'Console distance, km' }).fill('9.4')
  await page.getByRole('button', { name: 'Save log' }).click()
  await expect(page.getByText('Pick one first. The Coach runs on it.')).toBeVisible()
  await page.getByRole('radio', { name: '7', exact: true }).check({ force: true })
  await scan(page)
  await page.getByRole('button', { name: 'Save log' }).click()

  await expect(page).toHaveURL('/')
  await expect(bucket.getByRole('listitem').nth(2)).toHaveText(/^Threshold.*Done, Wed$/)
  await expect(page.getByRole('link', { name: /^Resume/ })).toHaveCount(0)
  await expect.poll(() => sent.at(-1)).toMatchObject({
    week: 3,
    sessionId: 'threshold',
    date: '2026-11-04',
    status: 'done',
    // Two minutes paused don't count.
    minutes: 45,
    rpe: 7,
    environment: 'indoor',
    distanceMeters: 9400,
    intervals: [
      { block: 1, rep: 1, targetPace: 292, held: true, actualPace: null },
      { block: 3, rep: 2, targetPace: 292, held: false, actualPace: 298 },
    ],
  })
})

test('a 5K test Live session records the time and updates the Training paces', async ({ page }) => {
  // Thursday of Week 2, Week 1 done in full: the baseline 5K test is Up next, and runs are RPE only.
  const thursday = new Date('2026-10-29T12:00:00-04:00')
  const sent = await serveHistory(page, weekDone(1, ['speed', 'strength', 'threshold', 'hyrox'], '2026-10-20'))
  await page.clock.install({ time: thursday })
  await page.goto('/')
  await page.clock.pauseAt(new Date(thursday.getTime() + 1000))

  await expect(page.getByRole('heading', { level: 1 })).toHaveText('5K test, baseline')
  await page.getByRole('button', { name: 'Start session' }).click()
  const s = live(page)
  await expect(s.block).toHaveText('Warm-up · 12 min')
  await expect(page.locator('header').getByText('Strides 4 × 15″')).toBeVisible()

  // Warm-up cut short; the 5 km runs to the distance, its clock counting up.
  await s.skip.click()
  await expect(s.block).toHaveText('5 km · 5 km')
  await expect(s.target).toHaveText('5')
  await expect(s.timer).toHaveText('00:00')
  await expect(s.line).toHaveText('All-out, but even. Tap Finished when the watch says 5 km.')
  await page.clock.runFor('22:30')
  await expect(s.timer).toHaveText('22:30')
  await s.skip.click()
  await expect(s.block).toHaveText('Cooldown · 8 min')

  // Ended in the cooldown: the 5 km was run, so it's Done, with its time.
  await page.getByRole('button', { name: 'End' }).click()
  await expect(page.getByText('Ended early')).toBeVisible()
  await expect(page.getByRole('textbox', { name: '5 km time' })).toHaveValue('22:30')
  // Outdoors in October: no console to read.
  await expect(page.getByRole('textbox', { name: /Console distance/ })).toHaveCount(0)
  await page.getByRole('radio', { name: '9', exact: true }).check({ force: true })
  await page.getByRole('button', { name: 'Save log' }).click()

  await expect(page).toHaveURL('/')
  await expect.poll(() => sent.at(-1)).toMatchObject({
    week: 2,
    sessionId: '5k-test',
    status: 'done',
    resultSeconds: 1350,
    environment: 'outdoor',
    distanceMeters: null,
    rpe: 9,
  })

  // The paces come from the new test at once: Threshold is 4:46/km outdoors.
  const bucket = page.getByRole('list').filter({ hasText: 'Strength' })
  await bucket.getByRole('button', { name: /^Threshold/ }).click()
  await expect(page.getByRole('heading', { level: 1 }).locator('xpath=following-sibling::p[1]')).toHaveText(/^4:46\/km/)
})
