import { expect, test, type Page } from '@playwright/test'
import { expectNoAxeViolations, WEEK_3 } from './axe'
import { caughtUp, serveHistory, weekDone } from './history'
import { aMinuteBefore, doToday, startAsChosen } from './today'

/**
 * Live run sessions under a controlled clock: the page's timers only move
 * when the test runs the clock forward. The server is stood in for, so these
 * write nothing to the shared database; the test reads what the page synced.
 */


/** Weeks 1 and 2 caught up, nothing logged in Week 3. */
const HISTORY = caughtUp(2)

/**
 * A Starting point with a 23:00 estimate on this device: Training paces from
 * it, so Threshold is 12.3 km/h (4:52/km) and the jogs 8.8 km/h.
 */
async function withEstimate(page: Page) {
  await page.addInitScript(() =>
    localStorage.setItem(
      'compromised:starting-point',
      JSON.stringify({ point: { fiveKSeconds: 1380, weights: {}, updatedAt: '2026-01-02T00:00:00.000Z' }, pending: false }),
    ),
  )
}

const bucketRow = (page: Page, name: RegExp) => page.getByRole('list').filter({ hasText: 'Strength' }).getByRole('button', { name })

const live = (page: Page) => {
  const band = page.locator('header')
  return {
    heading: page.getByRole('heading', { level: 1 }),
    block: band.locator('p').first(),
    target: band.locator('.stripe-num'),
    timer: band.getByRole('timer'),
    line: band.locator('[aria-live]'),
    pause: page.getByRole('button', { name: /^(Pause|Resume)$/ }),
    skip: page.getByRole('button', { name: /^(Skip block|Done|Finished .+)$/ }),
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

/** Week 3's Run picked for today and started, as chosen: the warm-up running. */
async function startRun(page: Page, at: Date) {
  await doToday(page, bucketRow(page, /^Run/))
  await page.clock.pauseAt(at)
  await page.getByRole('button', { name: 'Start Run' }).click()
  await startAsChosen(page)
  await expect(page).toHaveURL('/live')
  return live(page)
}

test('a full Threshold Run from Start to logged', async ({ page }) => {
  await withEstimate(page)
  const sent = await serveHistory(page, HISTORY)
  const start = new Date(WEEK_3.getTime() + 1000)
  await page.clock.install({ time: aMinuteBefore(WEEK_3) })
  await page.goto('/')
  const bucket = page.getByRole('list').filter({ hasText: 'Strength' })
  await doToday(page, bucketRow(page, /^Run/))
  await page.clock.pauseAt(start)

  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Run, 3 × 8′')
  await page.getByRole('button', { name: 'Start Run' }).click()
  await startAsChosen(page)

  await expect(page).toHaveURL('/live')
  await expect(page).toHaveTitle('Live session · Compromised')
  const s = live(page)
  await expect(s.heading).toHaveText('Run, 3 × 8′')
  await expect(s.heading).toBeFocused()
  await expect(s.block).toHaveText('Warm-up · 10 min')
  await expect(s.timer).toHaveText('10:00')
  await expect(page.getByRole('navigation')).toHaveCount(0)
  const blocks = page.getByRole('list', { name: 'Blocks' }).getByRole('listitem')
  await expect(blocks).toHaveText([
    /^Warm-up\s*10 min$/,
    /^Rep 1 of 3\s*12\.3 km\/h · 4:52\/km · 1% incline$/,
    /^Jog\s*90 s$/,
    /^Rep 2 of 3\s*12\.3 km\/h · 4:52\/km · 1% incline$/,
    /^Jog\s*90 s$/,
    /^Rep 3 of 3\s*12\.3 km\/h · 4:52\/km · 1% incline$/,
    /^Cooldown\s*8 min$/,
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
  await expect(s.block).toHaveText('Ready? Up next: Rep 1 of 3 · 12.3 km/h · 4:52/km · 1% incline')
  await expect(s.pause).toHaveCount(0)
  await page.clock.runFor('01:00')
  await expect(s.timer).toHaveText('08:00')
  await s.start.click()

  // Rep 1: the target speed huge, the pace per km below it, the incline and the time left.
  await expect(s.block).toHaveText('Rep 1 of 3 · 8 min')
  await expect(s.target).toHaveText('12.3')
  await expect(page.locator('header').getByText('km/h', { exact: true })).toBeVisible()
  await expect(page.locator('header').getByText('4:52/km', { exact: true })).toBeVisible()
  await expect(page.locator('header').getByText('1%')).toBeVisible()
  await expect(s.timer).toHaveText('08:00')
  await expect(s.line).toHaveText('Rep 1. Threshold. Do not race it.')
  await expect(blocks.nth(1)).toHaveAttribute('aria-current', 'step')
  // Rep 1 started 13 minutes in (three of them paused or waiting); the scan ends 30 seconds into it.
  await scan(page, minutes(start, 13.5))
  await expect(s.timer).toHaveText('07:30')

  // The rep is over: it asks, and saying nothing means it was held.
  await page.clock.runFor('07:30')
  await expect(s.block).toHaveText('Jog · 90 s')
  // The jog suggests a speed under Easy pace, and walking is fine.
  await expect(s.target).toHaveText('8.8')
  await expect(s.line).toHaveText('Jog or walk. Breathe. Pretend this is easy.')
  const check = page.getByRole('region', { name: 'Rep 1 of 3: held the target?' })
  await expect(check).toContainText('Rep 1 of 3: held 12.3 km/h?')
  await expect(check).toContainText('Say nothing and it logs as held.')

  // Rep 3 drifted: Changed, with the speed actually run. The earlier questions have gone, held.
  await page.clock.runFor('19:00')
  await expect(s.block).toHaveText('Cooldown · 8 min')
  await expect(check).toBeHidden()
  const third = page.getByRole('region', { name: 'Rep 3 of 3: held the target?' })
  await third.getByRole('button', { name: 'Changed' }).click()
  await third.getByRole('textbox', { name: 'Actual speed, km/h' }).fill('12.1')
  await third.getByRole('button', { name: 'Save' }).click()
  await expect(third).toBeHidden()
  expect(await s.pause.evaluate((el, before) => el === before, pauseButton)).toBe(true)

  // Away to Today and back, a reload each way: the session is still running, where it was.
  await page.clock.runFor('01:00')
  await page.goto('/')
  await page.getByRole('link', { name: 'Resume Run, 3 × 8′' }).click()
  await expect(page).toHaveURL('/live')
  await page.reload()
  await expect(s.block).toHaveText('Cooldown · 8 min')
  await expect(s.timer).toHaveText('07:00')

  // The last Block ends on the finish sheet.
  await page.clock.runFor('07:00')
  await expect(page.getByText('Session over')).toBeVisible()
  await expect(s.pause).toHaveCount(0)
  // The clock ran it out, no tap to take back: nothing to keep going with.
  await expect(page.getByRole('button', { name: 'Keep going' })).toHaveCount(0)
  await page.getByRole('textbox', { name: 'Console distance, km' }).fill('9.4')
  // Paced reps were asked one by one: no By-feel speeds at the end.
  await expect(page.getByRole('region', { name: 'By-feel speeds' })).toHaveCount(0)
  // Overall RPE starts on the Coach's guess for Threshold, said as a guess: Save is the only tap.
  await expect(page.getByRole('radio', { name: '7', exact: true })).toBeChecked()
  await expect(page.getByText('The Coach’s guess: 7.')).toBeVisible()
  await scan(page)
  await page.getByRole('button', { name: 'Save log' }).click()

  await expect(page).toHaveURL('/')
  await expect(bucket.getByRole('listitem').nth(2)).toHaveText(/^Run.*Done, Wed$/)
  await expect(page.getByRole('link', { name: /^Resume/ })).toHaveCount(0)
  await expect.poll(() => sent.at(-1)).toMatchObject({
    week: 3,
    sessionId: 'run',
    date: '2026-11-25',
    status: 'done',
    // Two minutes paused and one on Ready don't count.
    minutes: 45,
    rpe: 7,
    environment: 'indoor',
    distanceMeters: 9400,
    intervals: [
      { block: 1, rep: 1, targetPace: 292, held: true, actualPace: null },
      { block: 3, rep: 2, targetPace: 292, held: true, actualPace: null },
      { block: 5, rep: 3, targetPace: 292, held: false, actualPace: 298 },
    ],
  })
})

test('Start asks Treadmill or outside: the answer is the run’s Environment and the Session’s', async ({ page }) => {
  await withEstimate(page)
  const sent = await serveHistory(page, HISTORY)
  // Every month outside: nothing says treadmill until Start asks.
  await page.addInitScript(() =>
    localStorage.setItem('compromised:settings', JSON.stringify({ environmentByMonth: Array(12).fill('outdoor') })),
  )
  await page.clock.install({ time: aMinuteBefore(WEEK_3) })
  await page.goto('/')
  await doToday(page, bucketRow(page, /^Run/))
  await page.clock.pauseAt(new Date(WEEK_3.getTime() + 1000))
  await expect(page.getByRole('radio', { name: 'Outdoor' })).toBeChecked()

  // The month's default comes chosen, and focus lands on it; Today's own toggle steps aside.
  const start = page.getByRole('button', { name: 'Start Run' })
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
  await expect(page.getByRole('list', { name: 'Blocks' }).getByRole('listitem').nth(1)).toHaveText(/^Rep 1 of 3\s*12\.3 km\/h/)

  // Kept as the Session's own: Today shows Indoor for it now.
  await page.goto('/')
  await expect(page.getByRole('radio', { name: 'Indoor' })).toBeChecked()
  await page.getByRole('link', { name: 'Resume Run, 3 × 8′' }).click()
  await page.getByRole('button', { name: 'End' }).click()
  await page.getByRole('button', { name: 'Save log' }).click()
  await expect(page).toHaveURL('/')
  await expect.poll(() => sent.at(-1)).toMatchObject({ week: 3, sessionId: 'run', environment: 'indoor' })
})

test('a Session set Outdoor on Today comes to Start with Outside chosen', async ({ page }) => {
  await serveHistory(page, HISTORY)
  // November is a treadmill month by default; the Session's own Outdoor wins.
  await page.addInitScript(() => localStorage.setItem('compromised:environment', JSON.stringify({ '3/run': 'outdoor' })))
  await page.clock.install({ time: WEEK_3 })
  await page.goto('/')
  await doToday(page, bucketRow(page, /^Run/))
  await page.getByRole('button', { name: 'Start Run' }).click()
  const where = page.getByRole('region', { name: 'Treadmill or outside?' })
  await expect(where.getByRole('radio', { name: 'Outside' })).toBeChecked()
  await where.getByRole('button', { name: 'Start session' }).click()
  await expect(page).toHaveURL('/live')
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Run, 3 × 8′')
})

test('the target speed fits its column on a phone', async ({ page }) => {
  await withEstimate(page)
  await serveHistory(page, HISTORY)
  await page.clock.install({ time: WEEK_3 })
  await page.goto('/')
  await doToday(page, bucketRow(page, /^Run/))
  await page.getByRole('button', { name: 'Start Run' }).click()
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

test('a Compromised run test Live session logs every run and Station split', async ({ page }) => {
  // Wednesday of Week 2, Week 1 done in full: the baseline test is picked from the Bucket.
  const wednesday = new Date('2026-11-18T12:00:00-05:00')
  const sent = await serveHistory(page, weekDone(1, ['hyrox-a', 'hyrox-b', 'run', 'strength'], '2026-11-10'))
  // November is a treadmill month by default: this Week's test is set Outdoors.
  await page.addInitScript(() => localStorage.setItem('compromised:environment', JSON.stringify({ '2/compromised-run-test': 'outdoor' })))
  await page.clock.install({ time: aMinuteBefore(wednesday) })
  await page.goto('/')
  await doToday(page, bucketRow(page, /^Compromised run test/))
  await page.clock.pauseAt(new Date(wednesday.getTime() + 1000))

  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Compromised run test, baseline')
  await page.getByRole('button', { name: 'Start Compromised run test' }).click()
  await startAsChosen(page)
  const s = live(page)
  await expect(s.block).toHaveText('Warm-up · 8 min')
  await expect(page.getByRole('list', { name: 'Blocks' }).getByRole('listitem')).toHaveText([
    /^Warm-up\s*8 min$/,
    /^Strides\s*2 sets$/,
    /^Run 1\s*1 km$/,
    /^SkiErg\s*500 m$/,
    /^Run 2\s*1 km$/,
    /^Sled push\s*25 m$/,
    /^Run 3\s*1 km$/,
    /^Row\s*500 m$/,
    /^Run 4\s*1 km$/,
    /^Wall balls\s*50 reps$/,
    /^Cooldown\s*4 min$/,
  ])

  // The warm-up ended with Done, then the strides, a tick each; Run 1 waits for Start, then runs to the distance.
  await s.skip.click()
  await expect(s.block).toHaveText('Strides · 2 sets')
  await expect(s.line).toHaveText('Quick and relaxed. Not a sprint.')
  await page.getByRole('checkbox', { name: 'Strides · 1 of 2' }).click({ force: true })
  await s.skip.click()
  await expect(s.block).toHaveText('Ready? Up next: Run 1 · 1 km')
  await s.start.click()

  // Four runs and four Stations, each to its tap, the clock counting up.
  const legs: [block: string, line: RegExp, seconds: string][] = [
    ['Run 1 · 1 km', /^Run 1\. Full effort/, '04:10'],
    ['SkiErg · 500 m', /^Race load/, '02:05'],
    ['Run 2 · 1 km', /^Run 2\. Full effort on tired legs/, '04:20'],
    ['Sled push · 25 m', /^Race load/, '01:40'],
    ['Run 3 · 1 km', /^Run 3\./, '04:25'],
    ['Row · 500 m', /^Race load/, '02:00'],
    ['Run 4 · 1 km', /^Run 4\./, '04:35'],
    ['Wall balls · 50 reps', /^Race load/, '02:30'],
  ]
  for (const [block, line, seconds] of legs) {
    await expect(s.block).toHaveText(block)
    await expect(s.line).toHaveText(line)
    await page.clock.runFor(seconds)
    await expect(s.timer).toHaveText(seconds)
    await s.skip.click()
  }
  await expect(s.block).toHaveText('Cooldown · 4 min')

  // Ended in the cooldown: every run and Station was done, so it's Done.
  await page.getByRole('button', { name: 'End' }).click()
  await expect(page.getByText('Ended early')).toBeVisible()
  // Outdoors, and a circuit's runs are timed one by one: no console to read, no 5 km time.
  await expect(page.getByRole('textbox', { name: /Console distance/ })).toHaveCount(0)
  await expect(page.getByRole('textbox', { name: /time/ })).toHaveCount(0)
  await page.getByRole('radio', { name: '9', exact: true }).check({ force: true })
  await scan(page)
  await page.getByRole('button', { name: 'Save log' }).click()

  await expect(page).toHaveURL('/')
  await expect.poll(() => sent.at(-1)).toMatchObject({
    week: 2,
    sessionId: 'compromised-run-test',
    status: 'done',
    resultSeconds: null,
    environment: 'outdoor',
    distanceMeters: null,
    rpe: 9,
    stations: [
      { round: 1, part: 'run', meters: 1000, seconds: 250 },
      { round: 1, part: 'skierg', meters: 500, seconds: 125 },
      { round: 2, part: 'run', meters: 1000, seconds: 260 },
      { round: 2, part: 'sled-push', meters: 25, pounds: 335, seconds: 100 },
      { round: 3, part: 'run', meters: 1000, seconds: 265 },
      { round: 3, part: 'row', meters: 500, seconds: 120 },
      { round: 4, part: 'run', meters: 1000, seconds: 275 },
      { round: 4, part: 'wall-balls', reps: 50, pounds: 13, seconds: 150 },
    ],
  })
})

test('Done, Start, Undo, going back, and a Partial flipped to Done', async ({ page }) => {
  await withEstimate(page)
  const sent = await serveHistory(page, HISTORY)
  const start = new Date(WEEK_3.getTime() + 1000)
  await page.clock.install({ time: aMinuteBefore(WEEK_3) })
  await page.goto('/')
  const s = await startRun(page, start)
  const blocks = page.getByRole('list', { name: 'Blocks' })

  // Done on the warm-up three minutes in, then Undo: back on it with its clock still running.
  await expect(s.block).toHaveText('Warm-up · 10 min')
  await page.clock.runFor('03:00')
  await expect(s.skip).toHaveText('Done')
  await s.skip.click()
  await expect(s.block).toHaveText('Ready? Up next: Rep 1 of 3 · 12.3 km/h · 4:52/km · 1% incline')
  await expect(page.getByRole('status')).toContainText('Warm-up: done.')
  await page.clock.runFor('00:02')
  await s.undo.click()
  await expect(s.block).toHaveText('Warm-up · 10 min')
  await expect(s.timer).toHaveText('06:58')
  await s.skip.click()

  // Rep 1 waits for Start.
  await expect(s.block).toHaveText('Ready? Up next: Rep 1 of 3 · 12.3 km/h · 4:52/km · 1% incline')
  await page.clock.runFor('01:00')
  await expect(s.timer).toHaveText('08:00')
  await scan(page, minutes(start, 5))
  await s.start.click()

  // Rep 1 skipped by mistake, two minutes in: Undo, and the seconds since count toward it.
  await page.clock.runFor('02:00')
  await s.skip.click()
  await expect(s.block).toHaveText('Jog · 90 s')
  await expect(page.getByRole('status')).toContainText('Rep 1 of 3: skipped.')
  await page.clock.runFor('00:05')
  await s.undo.click()
  await expect(s.block).toHaveText('Rep 1 of 3 · 8 min')
  await expect(s.timer).toHaveText('05:55')

  // Skipped again, and left: Undo goes after about 8 s.
  await s.skip.click()
  await page.clock.runFor('00:09')
  await expect(s.undo).toHaveCount(0)

  // Back to Rep 1 from the lane list: it asks first, then resumes where it was left.
  await blocks.getByRole('button', { name: 'Rep 1 of 3, skipped' }).click()
  const back = page.getByRole('region', { name: 'Go back to Rep 1 of 3?' })
  await expect(back).toContainText('Go back to Rep 1 of 3? Rep 1 will be redone.')
  await back.getByRole('button', { name: 'Go back' }).click()
  await expect(s.block).toHaveText('Rep 1 of 3 · 8 min')
  await expect(s.timer).toHaveText('05:55')

  // Ended in Rep 1: the finish sheet lists what was cut short, and one tap logs it Done.
  await page.getByRole('button', { name: 'End' }).click()
  const cut = page.getByRole('region', { name: 'Cut short' })
  await expect(cut.getByRole('listitem')).toHaveText(['Rep 1 of 3: 2:05 of 8:00', 'Rep 2 of 3: not run', 'Rep 3 of 3: not run'])
  await expect(page.getByText('Cut short. It logs as Partial, which still counts.')).toBeVisible()
  await cut.getByRole('button', { name: 'Close enough: log it as Done' }).click()
  await expect(page.getByText('All of it. Now say how it felt.')).toBeVisible()
  await page.getByRole('button', { name: 'Save log' }).click()

  await expect(page).toHaveURL('/')
  await expect.poll(() => sent.at(-1)).toMatchObject({ week: 3, sessionId: 'run', status: 'done' })
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
  await withEstimate(page)
  const sent = await serveHistory(page, HISTORY)
  const start = new Date(WEEK_3.getTime() + 1000)
  await page.setViewportSize(SIDEWAYS)
  await page.clock.install({ time: aMinuteBefore(WEEK_3) })
  await page.goto('/')
  const s = await startRun(page, start)
  await s.skip.click()
  await s.start.click()

  // The target in both units, the incline and the clock on one side; the rep, the Coach's line and the next Block on the other.
  const band = page.locator('header')
  await expect(s.target).toHaveText('12.3')
  for (const words of ['km/h', '4:52/km', '1% incline']) await onScreen(band.getByText(words, { exact: true }))
  await expect(s.timer).toHaveText('08:00')
  await onScreen(s.timer)
  await onScreen(s.target)
  await onScreen(page.getByText('Rep 1 of 3 · 8 min', { exact: true }))
  await onScreen(page.getByText('Rep 1. Threshold. Do not race it.', { exact: true }))
  await onScreen(page.getByText('Then Jog · 90 s', { exact: true }))
  for (const control of [s.pause, s.skip, page.getByRole('button', { name: 'End' })]) await onScreen(control)
  const columns = await Promise.all([s.target, page.getByText('Rep 1 of 3 · 8 min', { exact: true })].map((l) => l.boundingBox()))
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
  const check = page.getByRole('region', { name: 'Rep 1 of 3: held the target?' })
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
    sessionId: 'run',
    status: 'partial',
    distanceMeters: 3000,
    intervals: [{ block: 1, rep: 1, targetPace: 292, held: false, actualPace: 298 }],
  })
})

test('on its side, the Strides checklist and every control fit and work', async ({ page }) => {
  const wednesday = new Date('2026-11-18T12:00:00-05:00')
  await serveHistory(page, weekDone(1, ['hyrox-a', 'hyrox-b', 'run', 'strength'], '2026-11-10'))
  await page.setViewportSize(SIDEWAYS)
  await page.clock.install({ time: aMinuteBefore(wednesday) })
  await page.goto('/')
  await doToday(page, bucketRow(page, /^Compromised run test/))
  await page.clock.pauseAt(new Date(wednesday.getTime() + 1000))
  await page.getByRole('button', { name: 'Start Compromised run test' }).click()
  await startAsChosen(page)
  const s = live(page)
  await s.skip.click()
  await expect(page.getByText('Strides · 2 sets', { exact: true })).toBeVisible()

  // Every set on the screen, with the controls and what's next.
  const sets = page.getByRole('list', { name: 'Sets' }).getByRole('checkbox')
  await expect(sets).toHaveCount(2)
  for (const set of await sets.all()) await onScreen(set.locator('xpath=ancestor::label[1]'))
  for (const control of [s.pause, s.skip, page.getByRole('button', { name: 'End' })]) await onScreen(control)
  await onScreen(page.getByText('Then Run 1 · 1 km', { exact: true }))
  await expectNoPageScroll(page)

  // Ticking the last set ends the Block.
  await page.getByRole('checkbox', { name: 'Strides · 1 of 2' }).click({ force: true })
  await page.getByRole('checkbox', { name: 'Strides · 2 of 2' }).click({ force: true })
  await expect(s.start).toBeVisible()
  await onScreen(s.start)
  await scan(page)

  // End: the finish sheet, one column, Save log under the thumb.
  await page.getByRole('button', { name: 'End', exact: true }).click()
  await onScreen(page.getByRole('button', { name: 'Save log' }))
  expect(await page.evaluate(() => document.scrollingElement!.scrollWidth - innerWidth)).toBeLessThanOrEqual(0)
})

test('on its side, Today and Live lifts have no sideways scroll', async ({ page }) => {
  await serveHistory(page, HISTORY)
  await page.setViewportSize(SIDEWAYS)
  await page.clock.install({ time: WEEK_3 })
  await page.goto('/')
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('HYROX A, 4 rounds')
  const sideways = () => page.evaluate(() => document.scrollingElement!.scrollWidth - innerWidth)
  expect(await sideways()).toBeLessThanOrEqual(0)

  await doToday(page, bucketRow(page, /^Strength/))
  await page.getByRole('button', { name: /^Start / }).click()
  await expect(page).toHaveURL('/live')
  await expect(page.locator('header .stripe-num')).toBeVisible()
  expect(await sideways()).toBeLessThanOrEqual(0)
  await onScreen(page.getByRole('button', { name: /^Log set/ }))
})

/** Week 1's Run on the treadmill, its jogs logged at 6 km/h. */
const WEEK_1_RUN = { week: 1, sessionId: 'run', date: '2026-11-11', status: 'done', environment: 'indoor', recoveryPace: 600 } as const

test('with no Training paces, the jog suggestion is the jog logged last time', async ({ page }) => {
  // No Starting point estimate: every run is RPE only, but Week 1's jogs were logged at 6 km/h.
  await serveHistory(page, caughtUp(2, [WEEK_1_RUN]))
  await page.clock.install({ time: aMinuteBefore(WEEK_3) })
  await page.goto('/')
  const s = await startRun(page, WEEK_3)
  await s.skip.click()
  await s.start.click()

  await page.clock.runFor('08:00')
  await expect(s.block).toHaveText('Jog · 90 s')
  await expect(s.target).toHaveText('6.0')
  await expect(page.locator('header')).toContainText('10:00/km')
})
