import { expect, test, type Page } from '@playwright/test'
import { BEFORE_WEEK_1, expectNoAxeViolations, WEEK_3 } from './axe'
import { BASELINE_HISTORY } from '../src/mock/scenarios/seed'
import { caughtUp, serveHistory, weekDone, type SeedLog } from './history'

const WEEK_2 = ['hyrox-a', 'hyrox-b', 'compromised-run-test', 'strength']

for (const colorScheme of ['light', 'dark'] as const) {
  test.describe(`Today, ${colorScheme}`, () => {
    test.use({ colorScheme })

    test('shows the countdown, the Phases, the Week and Up next, with no accessibility violations', async ({
      page,
    }) => {
      // Week 2 done in full, by Thursday: nothing Late, and too recent for a re-entry, so no Suggestion.
      await serveHistory(page, caughtUp(1, weekDone(2, WEEK_2, '2026-11-19')))
      await page.clock.setFixedTime(WEEK_3)
      await page.goto('/')

      const band = page.locator('header')
      await expect(band.locator('.stripe-num')).toHaveText('148')
      await expect(band.getByText('days to the race · Thu 22 April')).toBeVisible()
      await expect(page.getByRole('img', { name: /^Phases: Foundation 40% done, Build not started/ })).toBeVisible()
      await expect(band.getByText('Week 3 of 24 · Foundation')).toBeVisible()
      await expect(band.getByText('Mon 23 – Sun 29 Nov')).toBeVisible()

      // Bucket order: Strength first on fresh legs.
      await expect(page.getByRole('heading', { level: 1 })).toHaveText('Strength, squat 3 × 5')
      // Focus moves to the heading only when the screen changes, never on first load.
      await expect(page.getByRole('heading', { level: 1 })).not.toBeFocused()
      await expect(page.getByText(/^Squat\s3\s×\s5,\sRDL\s3\s×\s6\s·\sRPE\s7$/)).toBeVisible()

      const bucket = page.getByRole('list').filter({ hasText: 'HYROX B' })
      await expect(bucket.getByRole('listitem')).toHaveText([
        /^Strength.*Next$/,
        /^HYROX B/,
        /^Run/,
        /^HYROX A/,
        /^Easy run.*Optional$/,
      ])
      await expect(page.getByRole('region', { name: 'Coach’s Suggestion' })).toHaveCount(0)

      await expectNoAxeViolations(page)
    })

    test('before the Program starts, counts down to Week 1 with nothing to do today', async ({ page }) => {
      await page.clock.setFixedTime(BEFORE_WEEK_1)
      await page.goto('/')

      await expect(page.locator('header .stripe-num')).toHaveText('170')
      await expect(page.getByText('Week 1 starts Mon 9 Nov')).toBeVisible()
      await expect(page.getByRole('heading', { level: 1 })).toHaveText('Week 1 starts Monday.')
      await expect(page.getByRole('heading', { level: 2 })).toHaveText(/^Week 1/)
      await expect(page.getByText('Next', { exact: true })).toHaveCount(0)

      await expectNoAxeViolations(page)
    })
  })
}

test('counts the day in Toronto even when the phone is set to another time zone', async ({ browser }) => {
  // 00:30 Monday 23 November in Tokyo is still Sunday 22 November, Week 2, in Toronto.
  const context = await browser.newContext({ timezoneId: 'Asia/Tokyo' })
  const page = await context.newPage()
  await serveHistory(page, caughtUp(1))
  await page.clock.setFixedTime(new Date('2026-11-23T00:30:00+09:00'))
  await page.goto('/')
  await expect(page.getByText('Week 2 of 24 · Foundation')).toBeVisible()
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Strength, squat 3 × 5')
  await context.close()
})

test('phases the countdown stripes from the glyph top to the baseline', async ({ page }) => {
  await page.clock.setFixedTime(WEEK_3)
  await page.goto('/')
  await page.evaluate(() => document.fonts.ready)

  const geometry = await page.locator('header .stripe-num').evaluate((el) => {
    const px = (name: string) => parseFloat(getComputedStyle(el).getPropertyValue(name))
    const fontSize = parseFloat(getComputedStyle(el).fontSize)
    const baseline = el.querySelector('.bl')!.getBoundingClientRect().top - el.getBoundingClientRect().top
    return { top: px('--st'), height: px('--ch'), period: px('--per'), gap: px('--band'), baseline, fontSize }
  })

  const stripe = geometry.period - geometry.gap
  // The striped area ends exactly on the baseline…
  expect(geometry.top + geometry.height).toBeCloseTo(geometry.baseline, 1)
  // …starts at the top of the figures, about 0.7 em above it…
  expect(geometry.height / geometry.fontSize).toBeGreaterThan(0.6)
  expect(geometry.height / geometry.fontSize).toBeLessThan(0.8)
  // …and holds whole periods, so a full band of glyph shows at both edges.
  const periods = (geometry.height + stripe) / geometry.period
  expect(Math.abs(periods - Math.round(periods))).toBeLessThan(0.01)
  expect(Math.round(periods)).toBeGreaterThanOrEqual(3)
})

test('on the phone, Start sits in the bottom bar, in the thumb’s reach without scrolling', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === 'desktop', 'Desktop keeps Start in place, under Up next.')
  await serveHistory(page, caughtUp(1, weekDone(2, WEEK_2, '2026-11-16')))
  await page.clock.setFixedTime(WEEK_3)
  await page.goto('/')

  const start = page.getByRole('region', { name: 'Up next' }).getByRole('button', { name: 'Start Strength' })
  const box = (await start.boundingBox())!
  const height = page.viewportSize()!.height
  expect(box.y).toBeGreaterThan(height * 0.6)
  expect(box.y + box.height).toBeLessThanOrEqual(height)
  expect(box.height).toBeGreaterThanOrEqual(54)
  // Still there after scrolling to the Week list.
  await page.getByRole('heading', { name: 'This Week' }).scrollIntoViewIfNeeded()
  await expect(start).toBeInViewport()
})

test('taps past a rest the spacing rules only suggest, for today', async ({ page }) => {
  // Week 3: HYROX A Monday, Strength Wednesday. Thursday is a suggested rest, with HYROX B behind it
  // (the Run waits: never the day after Strength).
  const sent = await serveHistory(
    page,
    caughtUp(1, [
      ...weekDone(2, WEEK_2, '2026-11-16'),
      { week: 3, sessionId: 'hyrox-a', date: '2026-11-23', status: 'done' },
      { week: 3, sessionId: 'strength', date: '2026-11-25', status: 'done' },
    ]),
  )
  await page.clock.setFixedTime(new Date('2026-11-26T12:00:00-05:00'))
  await page.goto('/')

  const upNext = page.getByRole('heading', { level: 1 })
  await expect(upNext).toHaveText('Rest suggested.')
  await expect(page.getByText('Hard session yesterday. The Week has room, so legs up. Your call.')).toBeVisible()
  await expect(page.getByText('HYROX B if you go anyway')).toBeVisible()

  await page.getByRole('button', { name: 'Do it anyway' }).click()
  await expect(upNext).toHaveText(/^HYROX B/)
  await expect(upNext).toBeFocused()
  await expect(page.getByRole('button', { name: 'Do it anyway' })).toHaveCount(0)

  // Today only, and nothing saved: a reload keeps it, and the server heard nothing.
  await page.reload()
  await expect(upNext).toHaveText(/^HYROX B/)
  expect(sent).toEqual([])
})

test('suggests resting the Run the day after Strength, and taps past it', async ({ page }) => {
  // Week 3: HYROX A Monday, HYROX B Wednesday, Strength Saturday. Sunday, only the Run is left.
  await serveHistory(
    page,
    caughtUp(1, [
      ...weekDone(2, WEEK_2, '2026-11-16'),
      { week: 3, sessionId: 'hyrox-a', date: '2026-11-23', status: 'done' },
      { week: 3, sessionId: 'hyrox-b', date: '2026-11-25', status: 'done' },
      { week: 3, sessionId: 'strength', date: '2026-11-28', status: 'done' },
    ]),
  )
  await page.clock.setFixedTime(new Date('2026-11-29T12:00:00-05:00'))
  await page.goto('/')

  const upNext = page.getByRole('heading', { level: 1 })
  await expect(upNext).toHaveText('Rest suggested.')
  await expect(page.getByText('The Run on legs that just lifted? Better tomorrow. Your call.')).toBeVisible()
  await expect(page.getByText('Run if you go anyway')).toBeVisible()
  await page.getByRole('button', { name: 'Do it anyway' }).click()
  await expect(upNext).toHaveText(/^Run/)
})

test('puts the Run the day after HYROX', async ({ page }) => {
  // Week 3: Strength Monday, HYROX A Wednesday, HYROX B Saturday. Sunday, only the Run is left,
  // and HYROX yesterday doesn't hold it back the way Strength would.
  await serveHistory(
    page,
    caughtUp(1, [
      ...weekDone(2, WEEK_2, '2026-11-16'),
      { week: 3, sessionId: 'strength', date: '2026-11-23', status: 'done' },
      { week: 3, sessionId: 'hyrox-a', date: '2026-11-25', status: 'done' },
      { week: 3, sessionId: 'hyrox-b', date: '2026-11-28', status: 'done' },
    ]),
  )
  await page.clock.setFixedTime(new Date('2026-11-29T12:00:00-05:00'))
  await page.goto('/')
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(/^Run/)
})

test('offers a second Easy run in Build after a fully Done Week', async ({ page }) => {
  const WEEK_6 = ['hyrox-a', 'hyrox-b', 'run', 'strength']
  const week7Monday = new Date('2026-12-21T12:00:00-05:00')
  const bucket = page.getByRole('list').filter({ hasText: 'Easy run' })

  // Week 6 all Done: Week 7's Bucket holds both Easy runs, the second Optional too.
  await serveHistory(page, caughtUp(5, weekDone(6, WEEK_6, '2026-12-14')))
  await page.clock.setFixedTime(week7Monday)
  await page.goto('/')
  await expect(bucket.getByRole('listitem')).toHaveText([
    /^Strength/,
    /^HYROX B/,
    /^Run/,
    /^HYROX A/,
    /^Easy run.*Optional$/,
    /^Second Easy run.*Optional$/,
  ])
})

test('keeps to one Easy run after a Week with a required Session not Done', async ({ page }) => {
  const logs = [
    ...weekDone(6, ['hyrox-a', 'hyrox-b', 'run'], '2026-12-14'),
    { week: 6, sessionId: 'strength', date: '2026-12-17', status: 'swapped' as const },
  ]
  await serveHistory(page, caughtUp(5, logs))
  await page.clock.setFixedTime(new Date('2026-12-21T12:00:00-05:00'))
  await page.goto('/')
  const bucket = page.getByRole('list').filter({ hasText: 'Easy run' })
  await expect(bucket.getByRole('listitem')).toHaveCount(5)
  await expect(page.getByText('Second Easy run')).toHaveCount(0)
})

/** Every Station at full volume and Race load, as a Race simulation logs it: as in the Progress tests. */
const FULL = [
  ['skierg', 240, { meters: 1000 }],
  ['sled-push', 180, { meters: 50, pounds: 335 }],
  ['sled-pull', 200, { meters: 50, pounds: 225 }],
  ['burpee-broad-jumps', 250, { meters: 80 }],
  ['row', 245, { meters: 1000 }],
  ['farmers-carry', 90, { meters: 200, pounds: 55 }],
  ['sandbag-lunges', 260, { meters: 100, pounds: 45 }],
  ['wall-balls', 330, { reps: 100, pounds: 13 }],
] as const

const simulation = (week: number, date: string, legs: typeof FULL[number][]): SeedLog => ({
  week,
  sessionId: 'race-simulation',
  date,
  status: 'done',
  minutes: 65,
  rpe: 8,
  stations: legs.flatMap(([part, seconds, done], i) => [
    { round: i + 1, part: 'run', pounds: null, meters: 1000, reps: null, seconds: 300 },
    { round: i + 1, part, pounds: 'pounds' in done ? done.pounds : null, meters: 'meters' in done ? done.meters : null, reps: 'reps' in done ? done.reps : null, seconds },
  ]),
})

const finishRow = (page: Page) => page.getByRole('link', { name: /^Projected finish/ })

test('says nothing of the Projected finish until a lane is full', async ({ page }) => {
  await serveHistory(page, caughtUp(1))
  await page.clock.setFixedTime(WEEK_3)
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'This Week' })).toBeVisible()
  await expect(finishRow(page)).toHaveCount(0)
})

test('under the Week, counts the full lanes, and following it opens Progress', async ({ page }) => {
  // The baseline Compromised run test sets the Race run pace: the runs' lane is full, no Station's yet.
  await serveHistory(page, BASELINE_HISTORY)
  await page.clock.setFixedTime(WEEK_3)
  await page.goto('/')

  const row = finishRow(page)
  await expect(row).toHaveText('Projected finish · 1 of 9 lanes full')
  expect((await row.boundingBox())!.height).toBeGreaterThanOrEqual(44)
  await row.click()
  await expect(page).toHaveURL(/\/progress$/)
  await expect(page.getByRole('main').getByRole('region', { name: 'Projected finish' })).toContainText('1of 9 lanes full')
})

test('with all nine lanes full, gives the Projected finish and its Doubles share in one line', async ({ page }) => {
  await serveHistory(page, [
    ...BASELINE_HISTORY,
    simulation(16, '2027-02-27', FULL.slice(0, 4)),
    simulation(18, '2027-03-13', FULL.slice(4)),
  ])
  await page.clock.setFixedTime(new Date('2027-03-15T12:00:00-04:00'))
  await page.goto('/')

  // Solo 1795 + 8 × 307 + 360 = 4611 s; Doubles 897.5 + 2456 + 360 = 3713.5 s, as on Progress.
  const row = finishRow(page)
  await expect(row).toHaveText('Projected finish 1:16:51 · Doubles share 1:01:54')
  // One line, even at a phone's width.
  expect((await row.boundingBox())!.height).toBeLessThanOrEqual(44)
  await expectNoAxeViolations(page)
  await row.click()
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Progress')
})
