import { expect, test, type Page } from '@playwright/test'
import { expectNoAxeViolations, WEEK_3 } from './axe'
import { serveHistory, weekDone } from './history'

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
    finished: page.getByRole('button', { name: /^(Skip block|Finished .+)$/ }),
  }
}

/** axe waits on timers of its own, so the clock runs while it scans, then stops again at `then`. */
async function scan(page: Page, then?: Date) {
  await page.clock.resume()
  await expectNoAxeViolations(page)
  if (then) await page.clock.pauseAt(then)
}

const bucketOf = (page: Page) => page.getByRole('list').filter({ hasText: 'Strength' })

test('a three-round HYROX session, with a lighter sled from round 1 on', async ({ page }) => {
  const sent = await serveHistory(page, weekDone(2, ['5k-test', 'strength', 'threshold', 'hyrox'], '2026-10-28'))
  const start = new Date(WEEK_3.getTime() + 1000)
  await page.clock.install({ time: WEEK_3 })
  await page.goto('/')
  await page.clock.pauseAt(start)

  await bucketOf(page).getByRole('button', { name: /^HYROX/ }).click()
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('HYROX, 3 rounds')
  await page.getByRole('button', { name: 'Start session' }).click()

  await expect(page).toHaveURL('/live')
  const s = live(page)
  await expect(s.heading).toHaveText('HYROX, 3 rounds')
  await expect(s.block).toHaveText('Warm-up · 7 min')
  await expect(s.timer).toHaveText('07:00')
  const blocks = page.getByRole('list', { name: 'Blocks' }).getByRole('listitem')
  await expect(blocks).toHaveText([
    /^Warm-up\s*7 min$/,
    /^Round 1 of 3\s*600 m \+ 2 Stations$/,
    /^Round 2 of 3\s*600 m \+ 2 Stations$/,
    /^Round 3 of 3\s*600 m \+ 2 Stations$/,
    /^Cooldown\s*5 min$/,
  ])

  // Round 1: the run and both sleds at 60% of Race load, plates only. The clock counts up.
  await page.clock.runFor('07:00')
  await expect(s.block).toHaveText('Round 1 of 3 · 600 m + 2 Stations')
  await expect(s.target).toHaveText('600')
  await expect(page.locator('header').getByText('m run', { exact: true })).toBeVisible()
  await expect(s.stations).toHaveText(['Sled push 25 m · 200 lb plates', 'Sled pull 25 m · 135 lb plates'])
  await expect(s.line).toHaveText('Run, then the Stations. Technique before speed.')
  await expect(s.timer).toHaveText('00:00')
  await scan(page, new Date(start.getTime() + 7.5 * 60_000))
  await page.clock.runFor('09:30')
  await expect(s.timer).toHaveText('10:00')
  await s.finished.click()
  await expect(s.finished).toHaveText('Finished round 2')

  // Round 1 was heavy: the sled push went down to 180 lb.
  const check = page.getByRole('region', { name: 'Round 1 of 3: as written?' })
  await expect(check).toContainText('Round 1 of 3: 600 m + 2 Stations, as written?')
  await check.getByRole('button', { name: 'Changed' }).click()
  await expect(check.getByRole('textbox', { name: 'Run, m' })).toHaveValue('600')
  await check.getByRole('textbox', { name: 'Sled push, lb' }).fill('180')
  await check.getByRole('button', { name: 'Save' }).click()
  await expect(check).toBeHidden()
  await expect(s.stations).toHaveText(['Farmers carry 50 m · 2 × 30 lb', 'Sandbag lunges 25 m · 25 lb'])

  // Round 2 goes unanswered: it logs as written. Round 3's sled push follows the change.
  await page.clock.runFor('11:00')
  await s.finished.click()
  await expect(s.stations).toHaveText(['Sled push 25 m · 180 lb plates', 'Sled pull 25 m · 135 lb plates'])
  await expect(s.line).toHaveText('Last round. Same technique, tired legs.')
  await page.clock.runFor('10:30')
  await s.finished.click()
  await expect(s.block).toHaveText('Cooldown · 5 min')
  await expect(blocks.nth(2)).toHaveText(/^Round 2 of 3, done\s*600 m \+ 2 Stations · 11:00$/)

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
    rpe: 7,
    distanceMeters: null,
    intervals: [],
    stations: [
      row(1, 'round', { seconds: 600 }),
      row(1, 'run', { meters: 600 }),
      row(1, 'sled-push', { meters: 25, pounds: 180 }),
      row(1, 'sled-pull', { meters: 25, pounds: 135 }),
      row(2, 'round', { seconds: 660 }),
      row(2, 'run', { meters: 600 }),
      row(2, 'farmers-carry', { meters: 50, pounds: 30 }),
      row(2, 'sandbag-lunges', { meters: 25, pounds: 25 }),
      row(3, 'round', { seconds: 630 }),
      row(3, 'run', { meters: 600 }),
      row(3, 'sled-push', { meters: 25, pounds: 180 }),
      row(3, 'sled-pull', { meters: 25, pounds: 135 }),
    ],
  })
})

test('half simulation A logs a split for every run and Station, in race order', async ({ page }) => {
  // Wednesday of Week 18, Week 17 done.
  const wednesday = new Date('2027-02-17T12:00:00-05:00')
  const sent = await serveHistory(page, weekDone(17, ['5k-test', 'strength', 'threshold', 'hyrox'], '2027-02-10'))
  await page.clock.install({ time: wednesday })
  await page.goto('/')
  await page.clock.pauseAt(new Date(wednesday.getTime() + 1000))

  await bucketOf(page).getByRole('button', { name: /^Race simulation/ }).click()
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Race simulation, half A')
  await page.getByRole('button', { name: 'Start session' }).click()

  const s = live(page)
  await expect(s.block).toHaveText('Warm-up · 10 min')
  await s.finished.click()

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
