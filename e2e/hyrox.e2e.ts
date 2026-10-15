import { expect, test, type Page } from '@playwright/test'
import { expectNoAxeViolations, WEEK_3 } from './axe'
import { serveHistory, weekDone } from './history'
import { aMinuteBefore, doToday } from './today'

/**
 * HYROX and Race simulation Live sessions under a controlled clock. The
 * server is stood in for, so these write nothing to the shared database;
 * the test reads what the page synced.
 */

const live = (page: Page) => {
  const band = page.locator('header')
  return {
    heading: page.getByRole('heading', { level: 1 }),
    block: band.locator('p').first(),
    target: band.locator('.stripe-num'),
    timer: page.getByRole('timer'),
    line: band.locator('[aria-live]'),
    stations: band.getByRole('list', { name: 'Stations' }).getByRole('listitem'),
    /** A HYROX round's legs: the one on the clock, then the rest. */
    legs: band.getByRole('list', { name: 'Legs' }).getByRole('listitem'),
    finished: page.getByRole('button', { name: /^(Skip block|Done|Finished .+)$/ }),
    /** Start, on the Ready screen before a round or the first run. */
    start: page.getByRole('button', { name: 'Start', exact: true }),
  }
}

/** axe waits on timers of its own, so the clock runs while it scans, then stops again at `then`. */
async function scan(page: Page, then?: Date) {
  await page.clock.resume()
  await expectNoAxeViolations(page)
  if (then) await page.clock.pauseAt(then)
}

const bucketOf = (page: Page) => page.getByRole('list').filter({ hasText: 'Strength' })

test('a three-round HYROX session: Set up off the clock, then a lighter sled from round 1 on', async ({ page }) => {
  const sent = await serveHistory(page, weekDone(2, ['5k-test', 'strength', 'threshold', 'hyrox'], '2026-10-28'))
  const start = new Date(WEEK_3.getTime() + 1000)
  await page.clock.install({ time: aMinuteBefore(WEEK_3) })
  await page.goto('/')
  await doToday(page, bucketOf(page).getByRole('button', { name: /^HYROX/ }))
  await page.clock.pauseAt(start)

  await expect(page.getByRole('heading', { level: 1 })).toHaveText('HYROX, 3 rounds')
  // Set up isn't in the minutes: it shows beside them.
  await expect(page.getByText('45 min + ~5′ setup', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: /^Start / }).click()

  await expect(page).toHaveURL('/live')
  const s = live(page)
  await expect(s.heading).toHaveText('HYROX, 3 rounds')
  await expect(s.block).toHaveText('Warm-up · 5 min')
  await expect(s.timer).toHaveText('05:00')
  const blocks = page.getByRole('list', { name: 'Blocks' }).getByRole('listitem')
  await expect(blocks).toHaveText([
    /^Warm-up\s*5 min$/,
    /^Lunges\s*2 sets$/,
    /^Set up\s*4 Stations$/,
    /^Round 1 of 3\s*600 m \+ 2 Stations$/,
    /^Round 2 of 3\s*600 m \+ 2 Stations$/,
    /^Round 3 of 3\s*600 m \+ 2 Stations$/,
    /^Cooldown\s*5 min$/,
  ])

  // The jog runs its 5 minutes, then the lunges are ticked off.
  await page.clock.runFor('05:00')
  await expect(s.block).toHaveText('Lunges · 2 sets')
  await page.clock.runFor('01:00')
  await page.getByRole('checkbox', { name: 'Lunges 10 · 1 of 2' }).click({ force: true })
  await page.getByRole('checkbox', { name: 'Lunges 10 · 2 of 2' }).click({ force: true })

  // Set up: every Station of the Session at its load, on a stopwatch that's never training time.
  await expect(s.block).toHaveText('Set up · 4 Stations')
  await expect(s.stations).toHaveText([
    'Sled push 200 lb plates',
    'Sled pull 135 lb plates',
    'Farmers carry 2 × 30 lb',
    'Sandbag lunges 25 lb',
  ])
  await expect(s.line).toHaveText('Load every Station now. This clock isn’t training. Tap Done when it’s all set.')
  await expect(s.timer).toHaveText('00:00')
  await page.clock.runFor('04:00')
  await expect(s.timer).toHaveText('04:00')
  await expect(s.finished).toHaveText('Done')
  await s.finished.click()

  // Round 1 holds on Ready until Start: the run and both sleds at 60% of Race load, plates only.
  await expect(s.block).toHaveText('Ready? Up next: Round 1 of 3 · 600 m run')
  await s.start.click()
  await expect(s.block).toHaveText('Round 1 of 3 · 600 m + 2 Stations')
  // A tap at the end of each leg: the run first, its clock counting up.
  await expect(s.target).toHaveText('600')
  await expect(page.locator('header').getByText('m run', { exact: true })).toBeVisible()
  await expect(s.legs).toHaveText(['Run, now', 'Sled push · 25 m · 200 lb plates', 'Sled pull · 25 m · 135 lb plates'])
  await expect(s.line).toHaveText('Tap Finished at the end of every leg. Technique before speed.')
  await expect(s.timer).toHaveText('00:00')
  await expect(s.finished).toHaveText('Finished 600 m')
  await scan(page, new Date(start.getTime() + 10.5 * 60_000))
  await page.clock.runFor('02:30')
  await expect(s.timer).toHaveText('03:00')
  await s.finished.click()

  // The sled push, on a clock of its own; the run struck through with its split.
  await expect(s.block).toHaveText('Round 1 of 3 · 600 m + 2 Stations')
  await expect(s.target).toHaveText('25')
  await expect(page.locator('header').getByText('m Sled push', { exact: true })).toBeVisible()
  await expect(s.timer).toHaveText('00:00')
  await expect(s.legs).toHaveText(['Run · 600 m, done in 3:00', 'Sled push, now: 200 lb plates', 'Sled pull · 25 m · 135 lb plates'])
  await expect(s.finished).toHaveText('Finished Sled push')
  // A second tap a moment after is a bounce: still on the sled push.
  await s.finished.click()
  await expect(s.finished).toHaveText('Finished Sled push')
  await page.clock.runFor('03:30')
  await s.finished.click()
  await expect(s.finished).toHaveText('Finished Sled pull')
  await page.clock.runFor('03:30')
  await s.finished.click()
  await s.start.click()
  await expect(s.finished).toHaveText('Finished 600 m')

  // Round 1 was heavy: the sled push went down to 180 lb.
  const check = page.getByRole('region', { name: 'Round 1 of 3: as written?' })
  await expect(check).toContainText('Round 1 of 3: 600 m + 2 Stations, as written?')
  await check.getByRole('button', { name: 'Changed' }).click()
  await expect(check.getByRole('textbox', { name: 'Run, m' })).toHaveValue('600')
  await check.getByRole('textbox', { name: 'Sled push, lb' }).fill('180')
  await check.getByRole('button', { name: 'Save' }).click()
  await expect(check).toBeHidden()
  await expect(s.legs).toHaveText(['Run, now', 'Farmers carry · 50 m · 2 × 30 lb', 'Sandbag lunges · 25 m · 25 lb'])

  // Round 2 goes unanswered: it logs as written. Round 3's sled push follows the change.
  for (const leg of ['03:30', '03:30', '04:00']) {
    await page.clock.runFor(leg)
    await s.finished.click()
  }
  await s.start.click()
  await expect(s.legs).toHaveText(['Run, now', 'Sled push · 25 m · 180 lb plates', 'Sled pull · 25 m · 135 lb plates'])
  await expect(s.line).toHaveText('Last round. Same technique, tired legs.')
  for (const leg of ['03:20', '03:20', '03:20']) {
    await page.clock.runFor(leg)
    await s.finished.click()
  }
  await expect(s.block).toHaveText('Cooldown · 5 min')
  await expect(blocks.nth(4)).toHaveText(/^Round 2 of 3, done\s*600 m \+ 2 Stations · 11:00$/)

  await page.clock.runFor('05:00')
  await expect(page.getByText('Session over')).toBeVisible()
  // The runs are logged round by round: no console total to ask for.
  await expect(page.getByRole('textbox', { name: /Console distance/ })).toHaveCount(0)
  await page.getByRole('radio', { name: '7', exact: true }).check({ force: true })
  await scan(page)
  await page.getByRole('button', { name: 'Save log' }).click()

  await expect(page).toHaveURL('/')
  await expect(bucketOf(page).getByRole('listitem').nth(3)).toHaveText(/^HYROX.*Done, Wed$/)
  const row = (round: number, part: string, change: Record<string, number | null>) => ({
    round,
    part,
    pounds: null,
    meters: null,
    reps: null,
    seconds: null,
    ...change,
  })
  await expect.poll(() => sent.at(-1)).toMatchObject({
    week: 3,
    sessionId: 'hyrox',
    status: 'done',
    // 46 minutes on the clock, less the 4 setting up.
    minutes: 42,
    rpe: 7,
    distanceMeters: null,
    intervals: [],
    // Each round's time, then its run and each Station with a split of its own.
    stations: [
      row(1, 'round', { seconds: 600 }),
      row(1, 'run', { meters: 600, seconds: 180 }),
      row(1, 'sled-push', { meters: 25, pounds: 180, seconds: 210 }),
      row(1, 'sled-pull', { meters: 25, pounds: 135, seconds: 210 }),
      row(2, 'round', { seconds: 660 }),
      row(2, 'run', { meters: 600, seconds: 210 }),
      row(2, 'farmers-carry', { meters: 50, pounds: 30, seconds: 210 }),
      row(2, 'sandbag-lunges', { meters: 25, pounds: 25, seconds: 240 }),
      row(3, 'round', { seconds: 600 }),
      row(3, 'run', { meters: 600, seconds: 200 }),
      row(3, 'sled-push', { meters: 25, pounds: 180, seconds: 200 }),
      row(3, 'sled-pull', { meters: 25, pounds: 135, seconds: 200 }),
    ],
  })
})

test('on an iPhone SE a HYROX round fits: target, clock and action without scrolling, and each Block opens at the top', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 667 })
  await serveHistory(page, weekDone(2, ['5k-test', 'strength', 'threshold', 'hyrox'], '2026-10-28'))
  await page.clock.install({ time: aMinuteBefore(WEEK_3) })
  await page.goto('/')
  await doToday(page, bucketOf(page).getByRole('button', { name: /^HYROX/ }))
  await page.clock.pauseAt(new Date(WEEK_3.getTime() + 1000))
  await page.getByRole('button', { name: /^Start / }).click()

  const s = live(page)
  const blockList = page.getByRole('list', { name: 'Blocks' })
  const onScreen = async () => {
    // The page itself never scrolls; what doesn't fit scrolls inside the Block list.
    expect(await page.evaluate(() => document.documentElement.scrollHeight - innerHeight)).toBeLessThanOrEqual(0)
    for (const el of [s.target, s.timer, s.finished]) await expect(el).toBeInViewport({ ratio: 1 })
  }
  const scrollBlocksDown = () =>
    // The band too, in case a long Block let it scroll.
    blockList.evaluate((list) => {
      const rest = list.parentElement!
      rest.scrollTop = rest.scrollHeight
      rest.previousElementSibling!.scrollTop = rest.previousElementSibling!.scrollHeight
    })

  await expect(s.block).toHaveText('Warm-up · 5 min')
  await scrollBlocksDown()
  await s.finished.click()
  await page.getByRole('checkbox', { name: 'Lunges 10 · 1 of 2' }).click({ force: true })
  await page.getByRole('checkbox', { name: 'Lunges 10 · 2 of 2' }).click({ force: true })
  await expect(s.block).toHaveText('Set up · 4 Stations')
  await scrollBlocksDown()
  await s.finished.click()
  await s.start.click()

  await expect(s.block).toHaveText('Round 1 of 3 · 600 m + 2 Stations')
  await onScreen()
  await expect(page.locator('header')).toHaveJSProperty('scrollTop', 0)
  await expect(page.getByRole('heading', { level: 1 })).toBeInViewport()

  // Every leg keeps its target, clock and tap on screen.
  for (const leg of ['Finished Sled push', 'Finished Sled pull']) {
    await page.clock.runFor('03:20')
    await s.finished.click()
    await expect(s.finished).toHaveText(leg)
    await onScreen()
  }

  // Scrolled down the list mid-round, the next round still opens on its distance.
  await scrollBlocksDown()
  await page.clock.runFor('03:20')
  await s.finished.click()
  await s.start.click()
  await expect(s.block).toHaveText('Round 2 of 3 · 600 m + 2 Stations')
  await onScreen()
  await expect(page.locator('header')).toHaveJSProperty('scrollTop', 0)
})

test('a split too quick to be true is asked about before saving, and saved as put right', async ({ page }) => {
  const sent = await serveHistory(page, weekDone(2, ['5k-test', 'strength', 'threshold', 'hyrox'], '2026-10-28'))
  await page.clock.install({ time: aMinuteBefore(WEEK_3) })
  await page.goto('/')
  await doToday(page, bucketOf(page).getByRole('button', { name: /^HYROX/ }))
  await page.clock.pauseAt(new Date(WEEK_3.getTime() + 1000))
  await page.getByRole('button', { name: /^Start / }).click()

  const s = live(page)
  await s.finished.click()
  await page.getByRole('checkbox', { name: 'Lunges 10 · 1 of 2' }).click({ force: true })
  await page.getByRole('checkbox', { name: 'Lunges 10 · 2 of 2' }).click({ force: true })
  await s.finished.click()
  await s.start.click()

  // The thumb slipped: 600 m "run" in 0:20, so the sled push took the rest.
  await page.clock.runFor('00:20')
  await s.finished.click()
  await page.clock.runFor('05:40')
  await s.finished.click()
  await page.clock.runFor('03:30')
  await s.finished.click()
  await page.getByRole('button', { name: 'End' }).click()

  const quick = page.getByRole('region', { name: 'Too quick to be right' })
  const run = quick.getByRole('textbox', { name: 'Run, round 1 · 600 m' })
  await expect(run).toHaveValue('0:20')
  await expect(quick).toContainText('0:20 for 600 m is a slipped thumb, not a split.')
  await page.getByRole('radio', { name: '8', exact: true }).check({ force: true })
  // Saving as it is isn't an option: the time has to be put right or cleared.
  await page.getByRole('button', { name: 'Save log' }).click()
  await expect(quick).toContainText('0:20 can’t be right. Put the real time, or clear it to leave it untimed.')
  await expect(page).toHaveURL('/live')
  await run.fill('2:50')
  await scan(page)
  await page.getByRole('button', { name: 'Save log' }).click()

  await expect(page).toHaveURL('/')
  await expect.poll(() => (sent.at(-1) as { stations: unknown[] } | undefined)?.stations.slice(0, 4)).toEqual([
    { round: 1, part: 'round', pounds: null, meters: null, reps: null, seconds: 570 },
    { round: 1, part: 'run', pounds: null, meters: 600, reps: null, seconds: 170 },
    { round: 1, part: 'sled-push', pounds: 200, meters: 25, reps: null, seconds: 340 },
    { round: 1, part: 'sled-pull', pounds: 135, meters: 25, reps: null, seconds: 210 },
  ])
})

test('half simulation A logs a split for every run and Station, in race order', async ({ page }) => {
  // Wednesday of Week 18, Week 17 done.
  const wednesday = new Date('2027-02-17T12:00:00-05:00')
  const sent = await serveHistory(page, weekDone(17, ['5k-test', 'strength', 'threshold', 'hyrox'], '2027-02-10'))
  await page.clock.install({ time: aMinuteBefore(wednesday) })
  await page.goto('/')
  await doToday(page, bucketOf(page).getByRole('button', { name: /^Race simulation/ }))
  await page.clock.pauseAt(new Date(wednesday.getTime() + 1000))

  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Race simulation, half A')
  await page.getByRole('button', { name: /^Start / }).click()

  const s = live(page)
  await expect(s.block).toHaveText('Warm-up · 10 min')
  await s.finished.click()
  await expect(s.block).toHaveText('Ready? Up next: Run 1 · 1 km')
  await s.start.click()

  await expect(s.block).toHaveText('Run 1 · 1 km')
  await expect(s.target).toHaveText('1')
  await expect(s.line).toHaveText('Run 1. Conservative. The race is long.')
  await page.clock.runFor('04:30')
  await s.finished.click()

  await expect(s.block).toHaveText('SkiErg · 1 km')
  await expect(s.target).toHaveText('1')
  // The page never scrolls sideways on a phone.
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await page.clock.runFor('04:15')
  await expect(s.finished).toHaveText('Finished SkiErg')
  await s.finished.click()
  await page.getByRole('region', { name: 'SkiErg: as written?' }).getByRole('button', { name: 'As written' }).click()

  await expect(s.line).toHaveText('Run 2. RPE 8, not all-out.')
  await page.clock.runFor('04:45')
  await s.finished.click()
  await expect(s.block).toHaveText('Sled push · 50 m')
  await expect(page.locator('header').getByText('335 lb plates')).toBeVisible()
  await page.clock.runFor('03:00')
  await s.finished.click()
  // The sled push went with 315 lb.
  const sled = page.getByRole('region', { name: 'Sled push: as written?' })
  await sled.getByRole('button', { name: 'Changed' }).click()
  await sled.getByRole('textbox', { name: 'Sled push, lb' }).fill('315')
  await sled.getByRole('button', { name: 'Save' }).click()

  for (const [time, next] of [
    ['04:45', 'Sled pull · 50 m'],
    ['03:30', 'Run 4 · 1 km'],
    ['05:00', 'Burpee broad jumps · 80 m'],
    ['06:00', 'Cooldown · 5 min'],
  ] as const) {
    await page.clock.runFor(time)
    await s.finished.click()
    await expect(s.block).toHaveText(next)
  }
  const blocks = page.getByRole('list', { name: 'Blocks' }).getByRole('listitem')
  await expect(blocks.nth(1)).toHaveText(/^Run 1, done\s*1 km · 4:30$/)
  await expect(blocks.nth(4)).toHaveText(/^Sled push, done\s*50 m · 3:00$/)
  // Ten seconds of warm-up and 35:45 of runs and Stations: the scan ends a minute into the cooldown.
  await scan(page, new Date(wednesday.getTime() + 37 * 60_000))

  // Ended in the cooldown: every run and Station was done, so it's Done.
  await page.getByRole('button', { name: 'End' }).click()
  await expect(page.getByText('Ended early')).toBeVisible()
  await page.getByRole('radio', { name: '8', exact: true }).check({ force: true })
  await page.getByRole('button', { name: 'Save log' }).click()

  await expect(page).toHaveURL('/')
  const split = (round: number, part: string, meters: number, seconds: number, pounds: number | null = null) => ({
    round,
    part,
    pounds,
    meters,
    reps: null,
    seconds,
  })
  await expect.poll(() => sent.at(-1)).toMatchObject({
    week: 18,
    sessionId: 'race-simulation',
    status: 'done',
    rpe: 8,
    stations: [
      split(1, 'run', 1000, 270),
      split(1, 'skierg', 1000, 255),
      split(2, 'run', 1000, 285),
      split(2, 'sled-push', 50, 180, 315),
      split(3, 'run', 1000, 285),
      split(3, 'sled-pull', 50, 210, 225),
      split(4, 'run', 1000, 300),
      split(4, 'burpee-broad-jumps', 80, 360),
    ],
  })
})
