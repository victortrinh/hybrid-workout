import { expect, test, type Page } from '@playwright/test'
import { expectNoAxeViolations, WEEK_3 } from './axe'
import { serveHistory, weekDone } from './history'
import { aMinuteBefore, doToday, startAsChosen } from './today'

/**
 * Live run sessions under a controlled clock: the page's timers only move
 * when the test runs the clock forward. The server is stood in for, so these
 * write nothing to the shared database; the test reads what the page synced.
 */

/** Week 2 done, with a 23:00 5K test on the treadmill: Threshold is 12.3 km/h. */
const WEEK_2 = [
  { week: 2, sessionId: '5k-test', date: '2026-11-03', status: 'done', resultSeconds: 23 * 60, environment: 'indoor' },
  ...weekDone(2, ['strength', 'threshold', 'hyrox'], '2026-11-04'),
] as const

const live = (page: Page) => {
  const band = page.locator('header')
  return {
    heading: page.getByRole('heading', { level: 1 }),
    block: band.locator('p').first(),
    target: band.locator('.stripe-num'),
    timer: band.getByRole('timer'),
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
  await startAsChosen(page)

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
    /^Rep 1 of 2\s*12\.3 km\/h · 4:52\/km · 1% incline$/,
    /^Jog\s*2 min$/,
    /^Rep 2 of 2\s*12\.3 km\/h · 4:52\/km · 1% incline$/,
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
  await expect(s.block).toHaveText('Ready? Up next: Rep 1 of 2 · 12.3 km/h · 4:52/km · 1% incline')
  await expect(s.pause).toHaveCount(0)
  await page.clock.runFor('01:00')
  await expect(s.timer).toHaveText('12:00')
  await s.start.click()

  // Rep 1: the target speed huge, the pace per km below it, the incline and the time left.
  await expect(s.block).toHaveText('Rep 1 of 2 · 12 min')
  await expect(s.target).toHaveText('12.3')
  await expect(page.locator('header').getByText('km/h', { exact: true })).toBeVisible()
  await expect(page.locator('header').getByText('4:52/km', { exact: true })).toBeVisible()
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
  // The jog suggests a speed under Easy pace, and walking is fine.
  await expect(s.target).toHaveText('8.8')
  await expect(s.line).toHaveText('Jog or walk. Breathe. Pretend this is easy.')
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
  // Paced reps were asked one by one: no By-feel speeds at the end.
  await expect(page.getByRole('region', { name: 'By-feel speeds' })).toHaveCount(0)
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
    date: '2026-11-11',
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

test('Start asks Treadmill or outside: the answer is the run’s Environment and the Session’s', async ({ page }) => {
  const sent = await serveHistory(page, [...WEEK_2])
  // Every month outside, as October is: nothing says treadmill until Start asks.
  await page.addInitScript(() =>
    localStorage.setItem('compromised:settings', JSON.stringify({ environmentByMonth: Array(12).fill('outdoor') })),
  )
  await page.clock.install({ time: aMinuteBefore(WEEK_3) })
  await page.goto('/')
  await doToday(page, page.getByRole('list').filter({ hasText: 'Strength' }).getByRole('button', { name: /^Threshold/ }))
  await page.clock.pauseAt(new Date(WEEK_3.getTime() + 1000))
  await expect(page.getByRole('radio', { name: 'Outdoor' })).toBeChecked()

  // The month's default comes chosen, and focus lands on it; Today's own toggle steps aside.
  const start = page.getByRole('button', { name: 'Start Threshold' })
  await start.click()
  const where = page.getByRole('region', { name: 'Treadmill or outside?' })
  await expect(where.getByRole('radio', { name: 'Outside' })).toBeChecked()
  await expect(where.getByRole('radio', { name: 'Outside' })).toBeFocused()
  await expect(page.getByRole('radio', { name: 'Outdoor' })).toHaveCount(0)
  await scan(page)

  // Not now goes back to Start, with nothing changed.
  await where.getByRole('button', { name: 'Not now' }).click()
  await expect(start).toBeFocused()
  await expect(page.getByRole('radio', { name: 'Outdoor' })).toBeChecked()

  // By keyboard: Treadmill, then Start session.
  await start.press('Enter')
  await expect(where.getByRole('radio', { name: 'Outside' })).toBeFocused()
  await page.keyboard.press('ArrowLeft')
  await expect(where.getByRole('radio', { name: 'Treadmill' })).toBeChecked()
  await page.keyboard.press('Tab')
  await expect(where.getByRole('button', { name: 'Start session' })).toBeFocused()
  await page.keyboard.press('Enter')

  // Indoor targets for the whole run: speed and incline, not pace.
  await expect(page).toHaveURL('/live')
  await expect(page.getByRole('list', { name: 'Blocks' }).getByRole('listitem').nth(1)).toHaveText(/^Rep 1 of 2\s*12\.3 km\/h/)

  // Kept as the Session's own: Today shows Indoor for it now.
  await page.goto('/')
  await expect(page.getByRole('radio', { name: 'Indoor' })).toBeChecked()
  await page.getByRole('link', { name: 'Resume Threshold, 2 × 12′' }).click()
  await page.getByRole('button', { name: 'End' }).click()
  await page.getByRole('button', { name: 'Save log' }).click()
  await expect(page).toHaveURL('/')
  await expect.poll(() => sent.at(-1)).toMatchObject({ week: 3, sessionId: 'threshold', environment: 'indoor' })
})

test('a Session set Outdoor on Today comes to Start with Outside chosen', async ({ page }) => {
  await serveHistory(page, [...WEEK_2])
  // November is a treadmill month by default; the Session's own Outdoor wins.
  await page.addInitScript(() => localStorage.setItem('compromised:environment', JSON.stringify({ '3/speed': 'outdoor' })))
  await page.clock.setFixedTime(WEEK_3)
  await page.goto('/')
  await page.getByRole('button', { name: 'Start Speed' }).click()
  const where = page.getByRole('region', { name: 'Treadmill or outside?' })
  await expect(where.getByRole('radio', { name: 'Outside' })).toBeChecked()
  await where.getByRole('button', { name: 'Start session' }).click()
  await expect(page).toHaveURL('/live')
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Speed, 5 × 3′')
})

test('the target speed fits its column on a phone', async ({ page }) => {
  await serveHistory(page, [...WEEK_2])
  await page.clock.install({ time: WEEK_3 })
  await page.goto('/')
  await page.getByRole('list').filter({ hasText: 'Strength' }).getByRole('button', { name: /^Threshold/ }).click()
  await page.getByRole('button', { name: /^Do it today/ }).click()
  await page.getByRole('button', { name: /^Start / }).click()
  await startAsChosen(page)
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
  const thursday = new Date('2026-11-05T12:00:00-05:00')
  const sent = await serveHistory(page, weekDone(1, ['speed', 'strength', 'threshold', 'hyrox'], '2026-10-27'))
  // November is a treadmill month by default: this Week's 5K test and Threshold are set Outdoors.
  await page.addInitScript(() =>
    localStorage.setItem('compromised:environment', JSON.stringify({ '2/5k-test': 'outdoor', '2/threshold': 'outdoor' })),
  )
  await page.clock.install({ time: thursday })
  await page.goto('/')
  await page.clock.pauseAt(new Date(thursday.getTime() + 1000))

  await expect(page.getByRole('heading', { level: 1 })).toHaveText('5K test, baseline')
  await page.getByRole('button', { name: /^Start / }).click()
  await startAsChosen(page)
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
  // Outdoors: no console to read.
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

test('Speed: a rest between jump and acceleration sets, none between drills', async ({ page }) => {
  await serveHistory(page, [...WEEK_2])
  await page.clock.install({ time: WEEK_3 })
  await page.goto('/')
  await page.clock.pauseAt(new Date(WEEK_3.getTime() + 1000))
  await page.getByRole('button', { name: 'Start Speed' }).click()
  await startAsChosen(page)
  await expect(page).toHaveURL('/live')
  const s = live(page)
  const rest = page.getByRole('timer', { name: 'Rest left' })

  // Warm-up Done; a drill ticked starts no rest.
  await s.skip.click()
  await expect(s.block).toHaveText('Drills · 7 sets')
  await page.getByRole('checkbox', { name: 'Leg swings 10 / leg' }).click({ force: true })
  await expect(rest).toHaveCount(0)
  await s.skip.click()
  await expect(s.block).toHaveText('Plyometrics · 5 sets')

  // Pogo set 1: 60″, counting down beside the checklist.
  await page.getByRole('checkbox', { name: 'Pogo jumps 15 · set 1 of 2' }).click({ force: true })
  await expect(rest).toHaveText('1:00')
  await page.clock.runFor('00:15')
  await expect(rest).toHaveText('0:45')
  await expect(page.getByRole('list', { name: 'Sets' })).toBeVisible()

  // Set 2 ticked early ends that rest and starts its own; unticking it clears it.
  await page.getByRole('checkbox', { name: 'Pogo jumps 15 · set 2 of 2' }).click({ force: true })
  await expect(rest).toHaveText('1:00')
  await page.getByRole('checkbox', { name: 'Pogo jumps 15 · set 2 of 2' }).click({ force: true })
  await expect(rest).toHaveCount(0)

  // Ticked again and left to run out: the rest goes on its own.
  await page.getByRole('checkbox', { name: 'Pogo jumps 15 · set 2 of 2' }).click({ force: true })
  await page.clock.runFor('01:01')
  await expect(rest).toHaveCount(0)

  // Broad jumps: 20″, Skip ends it.
  await page.getByRole('checkbox', { name: 'Broad jumps 3 · set 1 of 3' }).click({ force: true })
  await expect(rest).toHaveText('0:20')
  await page.getByRole('button', { name: 'Skip', exact: true }).click()
  await expect(rest).toHaveCount(0)

  // Done mid-rest clears it; Accelerations rest 45″, and End clears that one.
  await page.getByRole('checkbox', { name: 'Broad jumps 3 · set 2 of 3' }).click({ force: true })
  await expect(rest).toHaveText('0:20')
  await s.skip.click()
  await expect(s.block).toHaveText('Accelerations · 4 sets')
  await expect(rest).toHaveCount(0)
  await page.getByRole('checkbox', { name: 'Accelerations · 1 of 4' }).click({ force: true })
  await expect(rest).toHaveText('0:45')
  await scan(page, new Date(WEEK_3.getTime() + 10 * 60_000))
  await page.getByRole('button', { name: 'End', exact: true }).click()
  await expect(rest).toHaveCount(0)
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
  await startAsChosen(page)
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
  await page.getByRole('checkbox', { name: 'Pogo jumps 15 · set 1 of 2' }).check({ force: true })
  await expect(page.getByRole('checkbox', { name: 'Pogo jumps 15 · set 1 of 2' })).toBeChecked()
  await scan(page, new Date(start.getTime() + 5 * 60_000))
  for (const name of ['Pogo jumps 15 · set 2 of 2', 'Broad jumps 3 · set 1 of 3', 'Broad jumps 3 · set 2 of 3', 'Broad jumps 3 · set 3 of 3']) {
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

/** A phone on its side in the treadmill's holder. */
const SIDEWAYS = { width: 812, height: 375 }

/** The page itself never scrolls, either way: only a column inside it may. */
async function expectNoPageScroll(page: Page) {
  const page_ = await page.evaluate(() => {
    const root = document.scrollingElement!
    return { width: root.scrollWidth, height: root.scrollHeight, innerWidth, innerHeight }
  })
  expect(page_.width, 'no sideways page scroll').toBeLessThanOrEqual(page_.innerWidth)
  expect(page_.height, 'no page scroll').toBeLessThanOrEqual(page_.innerHeight)
}

/** All of it on the screen, nothing cut off at an edge. */
const onScreen = (locator: ReturnType<Page['locator']>) => expect(locator).toBeInViewport({ ratio: 1 })

test('on its side, a Threshold rep: the target and the clock on the field, the rep, the Coach and what’s next beside', async ({ page }) => {
  const sent = await serveHistory(page, [...WEEK_2])
  const start = new Date(WEEK_3.getTime() + 1000)
  await page.setViewportSize(SIDEWAYS)
  await page.clock.install({ time: aMinuteBefore(WEEK_3) })
  await page.goto('/')
  await doToday(page, page.getByRole('list').filter({ hasText: 'Strength' }).getByRole('button', { name: /^Threshold/ }))
  await page.clock.pauseAt(start)
  await page.getByRole('button', { name: /^Start / }).click()
  await startAsChosen(page)
  const s = live(page)
  await s.skip.click()
  await s.start.click()

  // The target in both units, the incline and the clock on one side; the rep, the Coach's line and the next Block on the other.
  const band = page.locator('header')
  await expect(s.target).toHaveText('12.3')
  for (const words of ['km/h', '4:52/km', '1% incline']) await onScreen(band.getByText(words, { exact: true }))
  await expect(s.timer).toHaveText('12:00')
  await onScreen(s.timer)
  await onScreen(s.target)
  await onScreen(page.getByText('Rep 1 of 2 · 12 min', { exact: true }))
  await onScreen(page.getByText('Rep 1. Threshold. Do not race it.', { exact: true }))
  await onScreen(page.getByText('Then Jog · 2 min', { exact: true }))
  for (const control of [s.pause, s.skip, page.getByRole('button', { name: 'End' })]) await onScreen(control)
  const columns = await Promise.all([s.target, page.getByText('Rep 1 of 2 · 12 min', { exact: true })].map((l) => l.boundingBox()))
  expect(columns[0]!.x + columns[0]!.width, 'the target left of the rep').toBeLessThan(columns[1]!.x)
  await expectNoPageScroll(page)
  await scan(page, minutes(start, 1))

  // Pause and Resume work where they are.
  await s.pause.click()
  await expect(s.pause).toHaveText('Resume')
  await s.pause.click()

  // The rep over: Held it or Changed, beside the jog's target.
  await s.skip.click()
  await expect(s.target).toHaveText('8.8')
  const check = page.getByRole('region', { name: 'Rep 1 of 2: held the target?' })
  await check.getByRole('button', { name: 'Changed' }).click()
  const actual = check.getByRole('textbox', { name: 'Actual speed, km/h' })
  await expect(actual).toBeFocused()
  await actual.fill('12.1')
  await check.getByRole('button', { name: 'Save' }).click()
  await expect(check).toBeHidden()
  await expectNoPageScroll(page)

  // End: the finish sheet, one column, its Save log under the thumb.
  await page.getByRole('button', { name: 'End' }).click()
  await expect(page.getByText('Ended early')).toBeVisible()
  await page.getByRole('radio', { name: '7', exact: true }).check({ force: true })
  await page.getByRole('textbox', { name: 'Console distance, km' }).fill('3')
  await onScreen(page.getByRole('button', { name: 'Save log' }))
  await onScreen(page.getByRole('button', { name: 'Keep going' }))
  await scan(page)
  await page.getByRole('button', { name: 'Save log' }).click()
  await expect(page).toHaveURL('/')
  await expect.poll(() => sent.at(-1)).toMatchObject({
    sessionId: 'threshold',
    status: 'partial',
    distanceMeters: 3000,
    intervals: [{ block: 1, rep: 1, targetPace: 292, held: false, actualPace: 298 }],
  })
})

test('on its side, the Plyometrics checklist, its rest and every control fit and work', async ({ page }) => {
  await serveHistory(page, [...WEEK_2])
  await page.setViewportSize(SIDEWAYS)
  await page.clock.install({ time: WEEK_3 })
  await page.goto('/')
  await page.clock.pauseAt(new Date(WEEK_3.getTime() + 1000))
  await page.getByRole('button', { name: 'Start Speed' }).click()
  await startAsChosen(page)
  const s = live(page)
  await s.skip.click()
  await s.skip.click()
  await expect(page.getByText('Plyometrics · 5 sets', { exact: true })).toBeVisible()

  // Every set on the screen, the rest beside them once one is ticked.
  const sets = page.getByRole('list', { name: 'Sets' }).getByRole('checkbox')
  await expect(sets).toHaveCount(5)
  for (const set of await sets.all()) await onScreen(set.locator('xpath=ancestor::label[1]'))
  await page.getByRole('checkbox', { name: 'Pogo jumps 15 · set 1 of 2' }).click({ force: true })
  const rest = page.getByRole('timer', { name: 'Rest left' })
  await expect(rest).toHaveText('1:00')
  await onScreen(rest)
  for (const control of [page.getByRole('button', { name: 'Skip', exact: true }), s.pause, s.skip, page.getByRole('button', { name: 'End' })]) {
    await onScreen(control)
  }
  await onScreen(page.getByText('Then Accelerations · 4 sets', { exact: true }))
  await expectNoPageScroll(page)

  // Skip ends the rest; the next tick starts one; Done moves on.
  await page.getByRole('button', { name: 'Skip', exact: true }).click()
  await expect(rest).toHaveCount(0)
  await page.getByRole('checkbox', { name: 'Pogo jumps 15 · set 2 of 2' }).click({ force: true })
  await expect(rest).toHaveText('1:00')
  await s.skip.click()
  await expect(page.getByText('Accelerations · 4 sets', { exact: true })).toBeVisible()
  await expect(rest).toHaveCount(0)
  await page.getByRole('checkbox', { name: 'Accelerations · 1 of 4' }).click({ force: true })
  await expect(rest).toHaveText('0:45')
  await scan(page)

  // End: the finish sheet asks the By-feel speeds, one column, Save log under the thumb.
  await page.getByRole('button', { name: 'End', exact: true }).click()
  const byFeel = page.getByRole('region', { name: 'By-feel speeds' })
  await byFeel.getByRole('textbox', { name: 'Hard reps, km/h' }).fill('15')
  await expect(byFeel.getByRole('textbox', { name: 'Hard reps, km/h' })).toHaveValue('15')
  await page.getByRole('radio', { name: '6', exact: true }).check({ force: true })
  await onScreen(page.getByRole('button', { name: 'Save log' }))
  expect(await page.evaluate(() => document.scrollingElement!.scrollWidth - innerWidth)).toBeLessThanOrEqual(0)
})

test('on its side, Today and Live lifts have no sideways scroll', async ({ page }) => {
  await serveHistory(page, [...WEEK_2])
  await page.setViewportSize(SIDEWAYS)
  await page.clock.install({ time: WEEK_3 })
  await page.goto('/')
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Speed, 5 × 3′')
  const sideways = () => page.evaluate(() => document.scrollingElement!.scrollWidth - innerWidth)
  expect(await sideways()).toBeLessThanOrEqual(0)

  await doToday(page, page.getByRole('list').filter({ hasText: 'Threshold' }).getByRole('button', { name: /^Strength/ }))
  await page.getByRole('button', { name: /^Start / }).click()
  await expect(page).toHaveURL('/live')
  await expect(page.locator('header .stripe-num')).toBeVisible()
  expect(await sideways()).toBeLessThanOrEqual(0)
  await onScreen(page.getByRole('button', { name: /^Log set/ }))
})

/** Speed, Week 3, from Start to Rep 1 started: the warm-up, drills, Plyometrics and Accelerations each ended with Done. */
async function toRep1(page: Page) {
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Speed, 5 × 3′')
  await page.getByRole('button', { name: 'Start Speed' }).click()
  await startAsChosen(page)
  const s = live(page)
  for (const block of ['Warm-up · 7 min', 'Drills · 7 sets', 'Plyometrics · 5 sets', 'Accelerations · 4 sets']) {
    await expect(s.block).toHaveText(block)
    await s.skip.click()
  }
  await expect(s.block).toHaveText('Ready? Up next: Rep 1 of 5 · 3 min')
  await s.start.click()
  return s
}

test('by-feel reps ask nothing as they go, and the speeds once at the end, on the treadmill', async ({ page }) => {
  const sent = await serveHistory(page, [...WEEK_2])
  await page.clock.install({ time: WEEK_3 })
  await page.goto('/')
  await page.clock.pauseAt(new Date(WEEK_3.getTime() + 1000))
  const s = await toRep1(page)

  // "Hard, by feel": nothing to hold, so nothing asked after the rep. Nothing logged before: no Last time.
  await expect(page.locator('header').getByText(/^Hard, by feel/)).toHaveText('Hard, by feel')
  await page.clock.runFor('03:00')
  await expect(s.block).toHaveText('Jog · 90 s')
  await expect(page.getByRole('region', { name: /held the target\?$/ })).toHaveCount(0)

  // Rep 2 skipped a minute in, then the rest runs out to the finish sheet.
  await page.clock.runFor('02:30')
  await expect(s.block).toHaveText('Rep 2 of 5 · 3 min')
  await s.skip.click()
  await page.clock.runFor('18:30')
  await expect(page.getByText('Session over')).toBeVisible()
  await expect(page.getByRole('region', { name: /held the target\?$/ })).toHaveCount(0)

  const speeds = page.getByRole('region', { name: 'By-feel speeds' })
  await expect(speeds).toContainText('Optional.')
  await speeds.getByRole('textbox', { name: 'Hard reps, km/h' }).fill('14')
  await speeds.getByRole('textbox', { name: 'Jogs, km/h' }).fill('6')
  await page.clock.resume()
  await expectNoAxeViolations(page)
  await page.getByRole('button', { name: 'Save log' }).click()

  await expect(page).toHaveURL('/')
  // 14 km/h on every rep that ran its course, Rep 2 left out; the jogs at 6 km/h.
  await expect.poll(() => sent.at(-1)).toMatchObject({
    week: 3,
    sessionId: 'speed',
    status: 'partial',
    environment: 'indoor',
    recoveryPace: 600,
    intervals: [4, 8, 10, 12].map((block) => ({ block, rep: block / 2 - 1, targetPace: null, held: false, actualPace: 257 })),
  })
  // Logged speeds are no 5K test: Threshold still reads off the 23:00 test.
  await doToday(page, page.getByRole('list').filter({ hasText: 'Strength' }).getByRole('button', { name: /^Threshold/ }))
  await expect(page.getByRole('heading', { level: 1 }).locator('xpath=following-sibling::p[1]')).toHaveText(/^12\.3\skm\/h/)
})

test('outdoors, the by-feel question asks pace per km, and skipping it still saves the log', async ({ page }) => {
  const sent = await serveHistory(page, [...WEEK_2])
  await page.addInitScript(() => localStorage.setItem('compromised:environment', JSON.stringify({ '3/speed': 'outdoor' })))
  await page.clock.install({ time: WEEK_3 })
  await page.goto('/')
  await page.clock.pauseAt(new Date(WEEK_3.getTime() + 1000))
  const s = await toRep1(page)

  // Rep 1 runs its course; End in the jog after it.
  await page.clock.runFor('03:30')
  await expect(s.block).toHaveText('Jog · 90 s')
  await page.getByRole('button', { name: 'End' }).click()
  const speeds = page.getByRole('region', { name: 'By-feel speeds' })
  await expect(speeds.getByRole('textbox', { name: 'Hard reps, per km' })).toBeVisible()
  await expect(speeds.getByRole('textbox', { name: 'Jogs, per km' })).toBeVisible()
  await page.getByRole('button', { name: 'Save log' }).click()

  await expect(page).toHaveURL('/')
  await expect.poll(() => sent.at(-1)).toMatchObject({
    sessionId: 'speed',
    status: 'partial',
    environment: 'outdoor',
    recoveryPace: null,
    intervals: [{ block: 4, rep: 1, targetPace: null, held: true, actualPace: null }],
  })
})

test('a by-feel pace that can’t be right holds the save until it’s put right', async ({ page }) => {
  const sent = await serveHistory(page, [...WEEK_2])
  await page.addInitScript(() => localStorage.setItem('compromised:environment', JSON.stringify({ '3/speed': 'outdoor' })))
  await page.clock.install({ time: WEEK_3 })
  await page.goto('/')
  await page.clock.pauseAt(new Date(WEEK_3.getTime() + 1000))
  const s = await toRep1(page)
  await page.clock.runFor('03:30')
  await expect(s.block).toHaveText('Jog · 90 s')
  await page.getByRole('button', { name: 'End' }).click()

  const hard = page.getByRole('textbox', { name: 'Hard reps, per km' })
  await hard.fill('045')
  await page.getByRole('button', { name: 'Save log' }).click()
  await expect(page.getByText('A pace like 4:17.')).toBeVisible()
  await expect(page).toHaveURL('/live')
  await hard.fill('417')
  await expect(hard).toHaveValue('4:17')
  await page.getByRole('textbox', { name: 'Jogs, per km' }).fill('1000')
  await page.getByRole('button', { name: 'Save log' }).click()

  await expect(page).toHaveURL('/')
  await expect.poll(() => sent.at(-1)).toMatchObject({
    environment: 'outdoor',
    recoveryPace: 600,
    intervals: [{ block: 4, rep: 1, targetPace: null, held: false, actualPace: 257 }],
  })
})


/** Week 1's Speed on the treadmill, its by-feel reps at 14 km/h and its jogs at 6 km/h. */
const WEEK_1_SPEED = {
  week: 1,
  sessionId: 'speed',
  date: '2026-10-27',
  status: 'done',
  environment: 'indoor',
  recoveryPace: 600,
  intervals: [4, 6, 8, 10, 12].map((block) => ({ block, rep: block / 2 - 1, targetPace: null, held: false, actualPace: 257 })),
} as const

test('by-feel reps show the speed logged last time, and the question at the end starts from it', async ({ page }) => {
  const sent = await serveHistory(page, [WEEK_1_SPEED, ...WEEK_2])
  await page.clock.install({ time: aMinuteBefore(WEEK_3) })
  await page.goto('/')
  await page.clock.pauseAt(WEEK_3)
  const s = await toRep1(page)

  // A hint beside the effort, never a target: no speed in the hero, nothing asked after the rep.
  await expect(page.locator('header').getByText(/^Hard, by feel/)).toHaveText('Hard, by feel · Last time 14.0 km/h')
  await expect(s.target).toHaveCount(0)
  await page.clock.runFor('03:00')
  await expect(s.block).toHaveText('Jog · 90 s')
  await expect(page.getByRole('region', { name: /held the target\?$/ })).toHaveCount(0)
  // The jog still comes off the 23:00 test, not the jog logged last time.
  await expect(s.target).toHaveText('8.8')

  await page.getByRole('button', { name: 'End' }).click()
  const speeds = page.getByRole('region', { name: 'By-feel speeds' })
  await expect(speeds.getByRole('textbox', { name: 'Hard reps, km/h' })).toHaveValue('14.0')
  await expect(speeds.getByRole('textbox', { name: 'Jogs, km/h' })).toHaveValue('6.0')
  await page.clock.resume()
  await page.getByRole('button', { name: 'Save log' }).click()

  await expect(page).toHaveURL('/')
  await expect.poll(() => sent.at(-1)).toMatchObject({
    sessionId: 'speed',
    recoveryPace: 600,
    intervals: [{ block: 4, rep: 1, targetPace: null, held: false, actualPace: 257 }],
  })
  // Logged speeds are no 5K test: Threshold still reads off the 23:00 test.
  await doToday(page, page.getByRole('list').filter({ hasText: 'Strength' }).getByRole('button', { name: /^Threshold/ }))
  await expect(page.getByRole('heading', { level: 1 }).locator('xpath=following-sibling::p[1]')).toHaveText(/^12\.3\skm\/h/)
})

test('outdoors, last time reads as a pace per km, converted from the treadmill', async ({ page }) => {
  await serveHistory(page, [WEEK_1_SPEED, ...WEEK_2])
  await page.addInitScript(() => localStorage.setItem('compromised:environment', JSON.stringify({ '3/speed': 'outdoor' })))
  await page.clock.install({ time: aMinuteBefore(WEEK_3) })
  await page.goto('/')
  await page.clock.pauseAt(WEEK_3)
  const s = await toRep1(page)

  await expect(page.locator('header').getByText(/^Hard, by feel/)).toHaveText('Hard, by feel · Last time 4:17/km')
  await page.clock.runFor('03:30')
  await expect(s.block).toHaveText('Jog · 90 s')
  await page.getByRole('button', { name: 'End' }).click()
  await expect(page.getByRole('textbox', { name: 'Hard reps, per km' })).toHaveValue('4:17')
  await expect(page.getByRole('textbox', { name: 'Jogs, per km' })).toHaveValue('10:00')
})

test('with no Training paces, the jog suggestion is the jog logged last time', async ({ page }) => {
  // No 5K test yet: every run is RPE only, but Week 1's jogs were logged at 6 km/h.
  await serveHistory(page, [WEEK_1_SPEED])
  await page.clock.install({ time: aMinuteBefore(WEEK_3) })
  await page.goto('/')
  // The baseline 5K test leads Today: Speed is picked from the Bucket.
  await doToday(page, page.getByRole('list').filter({ hasText: 'Strength' }).getByRole('button', { name: /^Speed/ }))
  await page.clock.pauseAt(WEEK_3)
  const s = await toRep1(page)

  await page.clock.runFor('03:00')
  await expect(s.block).toHaveText('Jog · 90 s')
  await expect(s.target).toHaveText('6.0')
  await expect(page.locator('header')).toContainText('10:00/km')
})
