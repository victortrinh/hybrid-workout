import { expect, test } from '@playwright/test'
import { BEFORE_WEEK_1, expectNoAxeViolations, WEEK_3 } from './axe'
import { caughtUp, serveHistory, weekDone } from './history'

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

      await expect(page.getByRole('heading', { level: 1 })).toHaveText('HYROX A, 4 rounds')
      // Focus moves to the heading only when the screen changes, never on first load.
      await expect(page.getByRole('heading', { level: 1 })).not.toBeFocused()
      await expect(page.getByText('Station, then 400 m, each round · Race load')).toBeVisible()

      const bucket = page.getByRole('list').filter({ hasText: 'Strength' })
      await expect(bucket.getByRole('listitem')).toHaveText([
        /^HYROX A.*Next$/,
        /^HYROX B/,
        /^Run/,
        /^Strength/,
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
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('HYROX A, 4 rounds')
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

  const start = page.getByRole('region', { name: 'Up next' }).getByRole('button', { name: 'Start HYROX A' })
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
