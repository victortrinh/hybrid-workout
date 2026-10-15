import { expect, test, type Page } from '@playwright/test'
import { expectNoAxeViolations, WEEK_3 } from './axe'
import { serveHistory, weekDone } from './history'
import { aMinuteBefore, doToday } from './today'

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
    skip: page.getByRole('button', { name: /^(Skip block|Done|Finished 5 km)$/ }),
    /** Start, on the Ready screen before work. */
    start: page.getByRole('button', { name: 'Start', exact: true }),
    undo: page.getByRole('status').getByRole('button', { name: 'Undo' }),
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
  await page.clock.install({ time: aMinuteBefore(WEEK_3) })
  await page.goto('/')
  const bucket = page.getByRole('list').filter({ hasText: 'Strength' })
  await doToday(page, bucket.getByRole('button', { name: /^Threshold/ }))
  await page.clock.pauseAt(start)

  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Threshold, 2 × 12′')
  await page.getByRole('button', { name: /^Start / }).click()

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

  // The warm-up is over; Rep 1 waits on Ready, and the wait counts nowhere.
  await page.clock.runFor('05:00')
  await expect(s.block).toHaveText('Ready? Up next: Rep 1 of 2 · 12.3 km/h')
  await expect(s.pause).toHaveCount(0)
  await page.clock.runFor('01:00')
  await expect(s.timer).toHaveText('12:00')
  await s.start.click()

  // Rep 1: the target speed huge, the incline and the time left.
  await expect(s.block).toHaveText('Rep 1 of 2 · 12 min')
  await expect(s.target).toHaveText('12.3')
  await expect(page.locator('header').getByText('km/h', { exact: true })).toBeVisible()
  await expect(page.locator('header').getByText('1%')).toBeVisible()
  await expect(s.timer).toHaveText('12:00')
  await expect(s.line).toHaveText('Rep 1. Threshold. Do not race it.')
  await expect(blocks.nth(1)).toHaveAttribute('aria-current', 'step')
  // Rep 1 started 13 minutes in (three of them paused or waiting); the scan ends 30 seconds into it.
  await scan(page, minutes(start, 13.5))
  await expect(s.timer).toHaveText('11:30')

  // The rep is over: it asks, and saying nothing means it was held.
  await page.clock.runFor('11:30')
  await expect(s.block).toHaveText('Jog · 2 min')
  const check = page.getByRole('region', { name: 'Rep 1 of 2: held the target?' })
  await expect(check).toContainText('Rep 1 of 2: held 12.3 km/h?')
  await expect(check).toContainText('Say nothing and it logs as held.')

  // Rep 2 drifted: Changed, with the speed actually run. Rep 1's question has gone, held.
  await page.clock.runFor('14:00')
  await expect(s.block).toHaveText('Easy and cooldown · 9 min')
  await expect(check).toBeHidden()
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
  // Overall RPE starts on the Coach's guess for Threshold, said as a guess: Save is the only tap.
  await expect(page.getByRole('radio', { name: '7', exact: true })).toBeChecked()
  await expect(page.getByText('The Coach’s guess: 7.')).toBeVisible()
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
    // Two minutes paused and one on Ready don't count.
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

test('the target speed fits its column on a phone', async ({ page }) => {
  await serveHistory(page, [...WEEK_2])
  await page.clock.install({ time: WEEK_3 })
  await page.goto('/')
  await page.getByRole('list').filter({ hasText: 'Strength' }).getByRole('button', { name: /^Threshold/ }).click()
  await page.getByRole('button', { name: /^Do it today/ }).click()
  await page.getByRole('button', { name: /^Start / }).click()
  const s = live(page)
  await s.skip.click()
  await expect(s.target).toHaveText('12.3')

  // Four characters at arm's length: the last digit is never cut off.
  for (const width of [320, 375, 430]) {
    await page.setViewportSize({ width, height: 800 })
    const fit = await s.target.evaluate((el) => {
      const column = el.parentElement!
      return { scroll: column.scrollWidth, client: column.clientWidth }
    })
    expect(fit.scroll, `at ${width} px`).toBeLessThanOrEqual(fit.client)
  }
})

test('a 5K test Live session records the time and updates the Training paces', async ({ page }) => {
  // Thursday of Week 2, Week 1 done in full: the baseline 5K test is Up next, and runs are RPE only.
  const thursday = new Date('2026-10-29T12:00:00-04:00')
  const sent = await serveHistory(page, weekDone(1, ['speed', 'strength', 'threshold', 'hyrox'], '2026-10-20'))
  await page.clock.install({ time: thursday })
  await page.goto('/')
  await page.clock.pauseAt(new Date(thursday.getTime() + 1000))

  await expect(page.getByRole('heading', { level: 1 })).toHaveText('5K test, baseline')
  await page.getByRole('button', { name: /^Start / }).click()
  const s = live(page)
  await expect(s.block).toHaveText('Warm-up · 10 min')

  // Warm-up ended with Done, then the strides, a tick each; the 5 km waits for Start, then runs to the distance, its clock counting up.
  await s.skip.click()
  await expect(s.block).toHaveText('Strides · 4 sets')
  await expect(s.line).toHaveText('Quick and relaxed. Not a sprint.')
  await expect(page.getByRole('list', { name: 'Sets' }).getByRole('checkbox')).toHaveCount(4)
  await page.getByRole('checkbox', { name: 'Strides · 1 of 4' }).click({ force: true })
  await s.skip.click()
  await expect(s.block).toHaveText('Ready? Up next: 5 km')
  await s.start.click()
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
  // The Live session is over: the clock can run again for the sheet to open.
  await page.clock.resume()
  await doToday(page, page.getByRole('list').filter({ hasText: 'Strength' }).getByRole('button', { name: /^Threshold/ }))
  await expect(page.getByRole('heading', { level: 1 }).locator('xpath=following-sibling::p[1]')).toHaveText(/^4:46\/km/)
})

test('Speed: Done, the checklists, Start, Undo, going back, and a Partial flipped to Done', async ({ page }) => {
  const sent = await serveHistory(page, [...WEEK_2])
  const start = new Date(WEEK_3.getTime() + 1000)
  await page.clock.install({ time: WEEK_3 })
  await page.goto('/')
  await page.clock.pauseAt(start)

  // Speed is Up next.
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Speed, 5 × 3′')
  await page.getByRole('button', { name: 'Start Speed' }).click()
  await expect(page).toHaveURL('/live')
  const s = live(page)
  const blocks = page.getByRole('list', { name: 'Blocks' })

  // Done on the warm-up three minutes in, then Undo: back on it with its clock still running.
  await expect(s.block).toHaveText('Warm-up · 7 min')
  await page.clock.runFor('03:00')
  await expect(s.skip).toHaveText('Done')
  await s.skip.click()
  await expect(s.block).toHaveText('Drills · 7 sets')
  await expect(page.getByRole('status')).toContainText('Warm-up: done.')
  await page.clock.runFor('00:02')
  await s.undo.click()
  await expect(s.block).toHaveText('Warm-up · 7 min')
  await expect(s.timer).toHaveText('03:58')
  await s.skip.click()

  // The drills, a tick each; Done leaves the rest.
  await expect(s.block).toHaveText('Drills · 7 sets')
  await expect(s.line).toHaveText('Drills. Sharp, not tired.')
  await expect(page.getByRole('list', { name: 'Sets' }).getByRole('listitem')).toHaveText([
    'Leg swings 10 / leg',
    'A-skips 20 m · 1 of 2',
    'A-skips 20 m · 2 of 2',
    'B-skips 20 m · 1 of 2',
    'B-skips 20 m · 2 of 2',
    'High knees 20 m',
    'Butt kicks 20 m',
  ])
  await page.getByRole('checkbox', { name: 'Leg swings 10 / leg' }).click({ force: true })
  await s.skip.click()
  await expect(s.block).toHaveText('Plyometrics · 5 sets')

  // Plyometrics count up; ticking the last set ends the Block.
  await expect(s.timer).toHaveText('00:00')
  await expect(s.line).toHaveText('Quality contacts. Full reset between jumps.')
  await page.clock.runFor('01:30')
  await expect(s.timer).toHaveText('01:30')
  const sets = page.getByRole('list', { name: 'Sets' }).getByRole('checkbox')
  await expect(sets).toHaveCount(5)
  await page.getByRole('checkbox', { name: 'Pogo jumps · set 1 of 2' }).check({ force: true })
  await expect(page.getByRole('checkbox', { name: 'Pogo jumps · set 1 of 2' })).toBeChecked()
  await scan(page, new Date(start.getTime() + 5 * 60_000))
  for (const name of ['Pogo jumps · set 2 of 2', 'Broad jumps · set 1 of 3', 'Broad jumps · set 2 of 3', 'Broad jumps · set 3 of 3']) {
    await page.getByRole('checkbox', { name }).click({ force: true })
  }
  await expect(s.block).toHaveText('Accelerations · 4 sets')
  await expect(page.getByRole('checkbox', { name: 'Accelerations · 1 of 4' })).toBeVisible()

  // Done on Accelerations: Rep 1 waits for Start.
  await s.skip.click()
  await expect(s.block).toHaveText('Ready? Up next: Rep 1 of 5 · 3 min')
  await page.clock.runFor('01:00')
  await expect(s.timer).toHaveText('03:00')
  await s.start.click()

  // Rep 1 skipped by mistake, two minutes in: Undo, and the seconds since count toward it.
  await page.clock.runFor('02:00')
  await s.skip.click()
  await expect(s.block).toHaveText('Jog · 90 s')
  await expect(page.getByRole('status')).toContainText('Rep 1 of 5: skipped.')
  await page.clock.runFor('00:05')
  await s.undo.click()
  await expect(s.block).toHaveText('Rep 1 of 5 · 3 min')
  await expect(s.timer).toHaveText('00:55')

  // Skipped again, and left: Undo goes after about 8 s.
  await s.skip.click()
  await page.clock.runFor('00:09')
  await expect(s.undo).toHaveCount(0)

  // Back to Rep 1 from the lane list: it asks first, then resumes where it was left.
  await blocks.getByRole('button', { name: 'Rep 1 of 5, skipped' }).click()
  const back = page.getByRole('region', { name: 'Go back to Rep 1 of 5?' })
  await expect(back).toContainText('Go back to Rep 1 of 5? Rep 1 will be redone.')
  await back.getByRole('button', { name: 'Go back' }).click()
  await expect(s.block).toHaveText('Rep 1 of 5 · 3 min')
  await expect(s.timer).toHaveText('00:55')

  // Ended in Rep 1: the finish sheet lists what was cut short, and one tap logs it Done.
  await page.getByRole('button', { name: 'End' }).click()
  const cut = page.getByRole('region', { name: 'Cut short' })
  await expect(cut.getByRole('listitem')).toHaveText([
    'Rep 1 of 5: 2:05 of 3:00',
    'Rep 2 of 5: not run',
    'Rep 3 of 5: not run',
    'Rep 4 of 5: not run',
    'Rep 5 of 5: not run',
  ])
  await expect(page.getByText('Cut short. It logs as Partial, which still counts.')).toBeVisible()
  await cut.getByRole('button', { name: 'Close enough: log it as Done' }).click()
  await expect(page.getByText('All of it. Now say how it felt.')).toBeVisible()
  await page.getByRole('button', { name: 'Save log' }).click()

  await expect(page).toHaveURL('/')
  await expect.poll(() => sent.at(-1)).toMatchObject({ week: 3, sessionId: 'speed', status: 'done' })
})
