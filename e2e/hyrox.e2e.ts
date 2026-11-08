import { expect, test, type Page } from '@playwright/test'
import { expectNoAxeViolations, WEEK_3 } from './axe'
import { caughtUp, serveHistory, weekDone } from './history'
import { aMinuteBefore } from './today'

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

/** Week 2 done; Wednesday of Week 3, nothing of it logged: HYROX A, its Key session, Up next. */
const WEEK_2 = weekDone(2, ['hyrox-a', 'hyrox-b', 'compromised-run-test', 'strength'], '2026-11-18')

test('a four-round HYROX session: Set up off the clock, each Station then its run, a lighter sled in round 1', async ({ page }) => {
  const sent = await serveHistory(page, caughtUp(1, WEEK_2))
  const start = new Date(WEEK_3.getTime() + 1000)
  await page.clock.install({ time: aMinuteBefore(WEEK_3) })
  await page.goto('/')

  await expect(page.getByRole('heading', { level: 1 })).toHaveText('HYROX A, 4 rounds')
  // Set up isn't in the minutes: it shows beside them. It also says the history has
  // loaded (Week 1's HYROX A would read "Week 1 · Late"), so only now is the clock
  // paused: paused first, a slow first load waits on a retry timer that never fires.
  await expect(page.getByText(/^45\smin\s\+\s~5′\ssetup/).filter({ visible: true }).first()).toBeVisible()
  await page.clock.pauseAt(start)
  await page.getByRole('button', { name: 'Start HYROX A' }).click()

  await expect(page).toHaveURL('/live')
  const s = live(page)
  await expect(s.heading).toHaveText('HYROX A, 4 rounds')
  await expect(s.block).toHaveText('Warm-up · 5 min')
  await expect(s.timer).toHaveText('05:00')
  const blocks = page.getByRole('list', { name: 'Blocks' }).getByRole('listitem')
  await expect(blocks).toHaveText([
    /^Warm-up\s*5 min$/,
    /^Set up\s*4 Stations$/,
    /^Round 1 of 4\s*1 Station \+ 400 m$/,
    /^Round 2 of 4\s*1 Station \+ 400 m$/,
    /^Round 3 of 4\s*1 Station \+ 400 m$/,
    /^Round 4 of 4\s*1 Station \+ 400 m$/,
    /^Cooldown\s*4 min$/,
  ])

  // The jog runs its 5 minutes.
  await page.clock.runFor('05:00')

  // Set up: every Station of the Session at Race load, on a stopwatch that's never training time.
  await expect(s.block).toHaveText('Set up · 4 Stations')
  await expect(s.stations).toHaveText([
    'Sled push 335 lb plates',
    'Sled pull 225 lb plates',
    'Farmers carry 2 × 55 lb',
    'Sandbag lunges 45 lb',
  ])
  await expect(s.line).toHaveText('Load every Station now. This clock isn’t training. Tap Done when it’s all set.')
  await expect(s.timer).toHaveText('00:00')
  await page.clock.runFor('04:00')
  await expect(s.timer).toHaveText('04:00')
  await expect(s.finished).toHaveText('Done')
  await s.finished.click()

  // Round 1 holds on Ready until Start: the sled push at Race load first, then the run.
  await expect(s.block).toHaveText('Ready? Up next: Round 1 of 4 · 25 m Sled push')
  await s.start.click()
  await expect(s.block).toHaveText('Round 1 of 4 · 1 Station + 400 m')
  // A tap at the end of each leg: the Station first, its clock counting up.
  await expect(s.target).toHaveText('25')
  await expect(page.locator('header').getByText('m Sled push', { exact: true })).toBeVisible()
  await expect(s.legs).toHaveText(['Sled push, now: 335 lb plates', 'Run · 400 m'])
  await expect(s.line).toHaveText('Tap Finished at the end of every leg. Technique before speed.')
  await expect(s.timer).toHaveText('00:00')
  await expect(s.finished).toHaveText('Finished Sled push')
  await scan(page, new Date(start.getTime() + 9.5 * 60_000))
  await page.clock.runFor('02:30')
  await expect(s.timer).toHaveText('03:00')
  await s.finished.click()

  // Then the run, on a clock of its own; the sled push struck through with its split.
  await expect(s.target).toHaveText('400')
  await expect(page.locator('header').getByText('m run', { exact: true })).toBeVisible()
  await expect(s.timer).toHaveText('00:00')
  await expect(s.legs).toHaveText(['Sled push · 25 m · 335 lb plates, done in 3:00', 'Run, now'])
  // A second tap a moment after is a bounce: still on the run.
  await s.finished.click()
  await expect(s.finished).toHaveText('Finished 400 m')
  await page.clock.runFor('02:00')
  await s.finished.click()
  await s.start.click()
  await expect(s.finished).toHaveText('Finished Sled pull')

  // Round 1 was heavy: the sled push went down to 315 lb.
  const check = page.getByRole('region', { name: 'Round 1 of 4: as written?' })
  await expect(check).toContainText('Round 1 of 4: 1 Station + 400 m, as written?')
  await check.getByRole('button', { name: 'Changed' }).click()
  await expect(check.getByRole('textbox', { name: 'Run, m' })).toHaveValue('400')
  await check.getByRole('textbox', { name: 'Sled push, lb' }).fill('315')
  await check.getByRole('button', { name: 'Save' }).click()
  await expect(check).toBeHidden()
  await expect(s.legs).toHaveText(['Sled pull, now: 225 lb plates', 'Run · 400 m'])

  // Rounds 2 and 3 go unanswered: they log as written.
  for (const legs of [['03:30', '02:00'], ['02:00', '02:00']]) {
    for (const leg of legs) {
      await page.clock.runFor(leg)
      await s.finished.click()
    }
    await s.start.click()
  }
  await expect(s.legs).toHaveText(['Sandbag lunges, now: 45 lb', 'Run · 400 m'])
  await expect(s.line).toHaveText('Last round. Same technique, tired legs.')
  for (const leg of ['03:00', '02:30']) {
    await page.clock.runFor(leg)
    await s.finished.click()
  }
  await expect(s.block).toHaveText('Cooldown · 4 min')
  await expect(blocks.nth(3)).toHaveText(/^Round 2 of 4, done\s*1 Station \+ 400 m · 5:30$/)

  await page.clock.runFor('04:00')
  await expect(page.getByText('Session over')).toBeVisible()
  // The runs are logged round by round: no console total to ask for.
  await expect(page.getByRole('textbox', { name: /Console distance/ })).toHaveCount(0)
  await page.getByRole('radio', { name: '7', exact: true }).check({ force: true })
  await scan(page)
  await page.getByRole('button', { name: 'Save log' }).click()

  await expect(page).toHaveURL('/')
  await expect(bucketOf(page).getByRole('listitem').nth(0)).toHaveText(/^HYROX A.*Done, Wed$/)
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
    sessionId: 'hyrox-a',
    status: 'done',
    rpe: 7,
    distanceMeters: null,
    intervals: [],
    // Each round's time, then its Station and its run, each with a split of its own.
    stations: [
      row(1, 'round', { seconds: 300 }),
      row(1, 'sled-push', { meters: 25, pounds: 315, seconds: 180 }),
      row(1, 'run', { meters: 400, seconds: 120 }),
      row(2, 'round', { seconds: 330 }),
      row(2, 'sled-pull', { meters: 25, pounds: 225, seconds: 210 }),
      row(2, 'run', { meters: 400, seconds: 120 }),
      row(3, 'round', { seconds: 240 }),
      row(3, 'farmers-carry', { meters: 100, pounds: 55, seconds: 120 }),
      row(3, 'run', { meters: 400, seconds: 120 }),
      row(4, 'round', { seconds: 330 }),
      row(4, 'sandbag-lunges', { meters: 25, pounds: 45, seconds: 180 }),
      row(4, 'run', { meters: 400, seconds: 150 }),
    ],
  })
})

test('on an iPhone SE a HYROX round fits: target, clock and action without scrolling, and each Block opens at the top', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 667 })
  await serveHistory(page, caughtUp(1, WEEK_2))
  await page.clock.install({ time: aMinuteBefore(WEEK_3) })
  await page.goto('/')
  await page.clock.pauseAt(new Date(WEEK_3.getTime() + 1000))
  await page.getByRole('button', { name: 'Start HYROX A' }).click()

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
  await expect(s.block).toHaveText('Set up · 4 Stations')
  await scrollBlocksDown()
  await s.finished.click()
  await s.start.click()

  await expect(s.block).toHaveText('Round 1 of 4 · 1 Station + 400 m')
  await onScreen()
  await expect(page.locator('header')).toHaveJSProperty('scrollTop', 0)
  await expect(page.getByRole('heading', { level: 1 })).toBeInViewport()

  // Every leg keeps its target, clock and tap on screen.
  await expect(s.finished).toHaveText('Finished Sled push')
  await page.clock.runFor('03:20')
  await s.finished.click()
  await expect(s.finished).toHaveText('Finished 400 m')
  await onScreen()

  // Scrolled down the list mid-round, the next round still opens on its distance.
  await scrollBlocksDown()
  await page.clock.runFor('03:20')
  await s.finished.click()
  await s.start.click()
  await expect(s.block).toHaveText('Round 2 of 4 · 1 Station + 400 m')
  await onScreen()
  await expect(page.locator('header')).toHaveJSProperty('scrollTop', 0)
})

test('a split too quick to be true is asked about before saving, and saved as put right', async ({ page }) => {
  const sent = await serveHistory(page, caughtUp(1, WEEK_2))
  await page.clock.install({ time: aMinuteBefore(WEEK_3) })
  await page.goto('/')
  await page.clock.pauseAt(new Date(WEEK_3.getTime() + 1000))
  await page.getByRole('button', { name: 'Start HYROX A' }).click()

  const s = live(page)
  await s.finished.click()
  await s.finished.click()
  await s.start.click()

  // The thumb slipped: the sled push tapped late, so the 400 m "run" took 0:20.
  await page.clock.runFor('03:00')
  await s.finished.click()
  await page.clock.runFor('00:20')
  await s.finished.click()
  await page.getByRole('button', { name: 'End' }).click()

  const quick = page.getByRole('region', { name: 'Too quick to be right' })
  const run = quick.getByRole('textbox', { name: 'Run, round 1 · 400 m' })
  await expect(run).toHaveValue('0:20')
  await expect(quick).toContainText('0:20 for 400 m is a slipped thumb, not a split.')
  await page.getByRole('radio', { name: '8', exact: true }).check({ force: true })
  // Saving as it is isn't an option: the time has to be put right or cleared.
  await page.getByRole('button', { name: 'Save log' }).click()
  await expect(quick).toContainText('0:20 can’t be right. Put the real time, or clear it to leave it untimed.')
  await expect(page).toHaveURL('/live')
  await run.fill('2:50')
  await scan(page)
  await page.getByRole('button', { name: 'Save log' }).click()

  await expect(page).toHaveURL('/')
  await expect.poll(() => (sent.at(-1) as { stations: unknown[] } | undefined)?.stations.slice(0, 3)).toEqual([
    { round: 1, part: 'round', pounds: null, meters: null, reps: null, seconds: 200 },
    { round: 1, part: 'sled-push', pounds: 335, meters: 25, reps: null, seconds: 180 },
    { round: 1, part: 'run', pounds: null, meters: 400, reps: null, seconds: 170 },
  ])
})

test('half simulation A logs a split for every run and Station, in race order', async ({ page }) => {
  // Wednesday of Week 16, the first of Race specific, Week 15 done: the Race simulation, its Key session, Up next.
  const wednesday = new Date('2027-02-24T12:00:00-05:00')
  const sent = await serveHistory(page, caughtUp(15, weekDone(15, ['hyrox-a', 'hyrox-b', 'run', 'strength'], '2027-02-17')))
  await page.clock.install({ time: aMinuteBefore(wednesday) })
  await page.goto('/')
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
    week: 16,
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

/** HYROX A done in Weeks 1 and 2 at RPE 6, every Station at Race load and Foundation volume, each run timed. */
const hyroxA = (week: number, date: string, sled: number, runs: number[]) => ({
  week,
  sessionId: 'hyrox-a',
  date,
  status: 'done' as const,
  rpe: 6,
  stations: [
    { round: 1, part: 'sled-push', pounds: 335, meters: 25, reps: null, seconds: sled },
    { round: 2, part: 'sled-pull', pounds: 225, meters: 25, reps: null, seconds: 150 },
    { round: 3, part: 'farmers-carry', pounds: 55, meters: 100, reps: null, seconds: 60 },
    { round: 4, part: 'sandbag-lunges', pounds: 45, meters: 25, reps: null, seconds: 90 },
    ...runs.map((seconds, i) => ({ round: i + 1, part: 'run', pounds: null, meters: 400, reps: null, seconds })),
  ],
})

test('each Station shows its Station target on the Session sheet and the round clock; the log shows the Fade', async ({ page }) => {
  const history = [
    hyroxA(1, '2026-11-10', 180, [100, 104, 106, 108]),
    hyroxA(2, '2026-11-17', 170, [100, 104, 108, 112]),
    ...weekDone(2, ['hyrox-b', 'compromised-run-test', 'strength'], '2026-11-18'),
  ]
  await serveHistory(page, caughtUp(2, history))
  await page.clock.install({ time: aMinuteBefore(WEEK_3) })
  await page.goto('/')
  await page.clock.pauseAt(new Date(WEEK_3.getTime() + 1000))

  // Two logs at each volume, both RPE 7 or under: the Station best less 3%, to the second.
  await page.getByRole('button', { name: 'Show the Prescription' }).click()
  const sheet = page.getByRole('dialog', { name: /^HYROX A, / })
  const rounds = sheet.getByRole('listitem').filter({ hasText: /Station target/ })
  await expect(rounds).toHaveText([
    /^Sled\spush\s·\s25\sm\s·\s335\slb\splates\s·\sStation\starget\s2:45$/,
    /^Sled\spull\s·\s25\sm\s·\s225\slb\splates\s·\sStation\starget\s2:26$/,
    /^Farmers\scarry\s·\s100\sm\s·\s2\s×\s55\slb\s·\sStation\starget\s0:58$/,
    /^Sandbag\slunges\s·\s25\sm\s·\s45\slb\s·\sStation\starget\s1:27$/,
  ])
  await page.keyboard.press('Escape')

  await page.getByRole('button', { name: 'Start HYROX A' }).click()
  const s = live(page)
  await s.finished.click()
  await expect(s.block).toHaveText('Set up · 4 Stations')
  await s.finished.click()
  await s.start.click()
  await expect(s.legs).toHaveText([/^Sled\spush,\snow:\s335\slb\splates\s·\sStation\starget\s2:45$/, /^Run\s·\s400\sm$/])
  await page.clock.runFor('02:40')
  await s.finished.click()
  await expect(s.legs).toHaveText([/^Sled\spush\s·\s25\sm\s·\s335\slb\splates\s·\sStation\starget\s2:45,\sdone\sin\s2:40$/, 'Run, now'])
  await page.clock.runFor('01:40')
  await s.finished.click()
  await s.start.click()
  await expect(s.legs).toHaveText([/^Sled\spull,\snow:\s225\slb\splates\s·\sStation\starget\s2:26$/, /^Run\s·\s400\sm$/])
  await scan(page)

  // Week 2's runs went from 250 to 280 s/km: the log says so.
  await page.goto('/plan/week/2')
  await expect(page.getByText(/Fade\s\+30\ss\/km/)).toBeVisible()
})
