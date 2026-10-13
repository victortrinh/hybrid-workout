import { expect, test } from '@playwright/test'
import { BEFORE_WEEK_1, expectNoAxeViolations, WEEK_3 } from './axe'

for (const colorScheme of ['light', 'dark'] as const) {
  test.describe(`Today, ${colorScheme}`, () => {
    test.use({ colorScheme })

    test('shows the countdown, the Phases, the Week and Up next, with no accessibility violations', async ({
      page,
    }) => {
      await page.clock.setFixedTime(WEEK_3)
      await page.goto('/')

      const band = page.locator('header')
      await expect(band.locator('.stripe-num')).toHaveText('168')
      await expect(band.getByText('days to the race · Wed 21 April')).toBeVisible()
      await expect(page.getByRole('img', { name: /^Phases: Foundation 33% done, 5K development not started/ })).toBeVisible()
      await expect(band.getByText('Week 3 of 27 · Foundation')).toBeVisible()
      await expect(band.getByText('Mon 2 – Sun 8 Nov')).toBeVisible()

      await expect(page.getByRole('heading', { level: 1 })).toHaveText('Speed, 5 × 3′')
      // Focus moves to the heading only when the screen changes, never on first load.
      await expect(page.getByRole('heading', { level: 1 })).not.toBeFocused()
      await expect(page.getByText('Hard, by feel · 90″ jog · 4 accelerations first')).toBeVisible()

      const bucket = page.getByRole('list').filter({ hasText: 'Strength' })
      await expect(bucket.getByRole('listitem')).toHaveText([
        /^Speed.*Next$/,
        /^Strength/,
        /^Threshold.*Key$/,
        /^HYROX/,
        /^Easy run.*Optional$/,
      ])

      await expectNoAxeViolations(page)
    })

    test('before the Program starts, counts down to Week 1 with nothing to do today', async ({ page }) => {
      await page.clock.setFixedTime(BEFORE_WEEK_1)
      await page.goto('/')

      await expect(page.locator('header .stripe-num')).toHaveText('190')
      await expect(page.getByText('Week 1 starts Mon 19 Oct')).toBeVisible()
      await expect(page.getByRole('heading', { level: 1 })).toHaveText('Week 1 starts Monday.')
      await expect(page.getByRole('heading', { level: 2 })).toHaveText(/^Week 1/)
      await expect(page.getByText('Next', { exact: true })).toHaveCount(0)

      await expectNoAxeViolations(page)
    })
  })
}

test('counts the day in Toronto even when the phone is set to another time zone', async ({ browser }) => {
  // 00:30 Monday 2 November in Tokyo is still Sunday 1 November, Week 2, in Toronto.
  const context = await browser.newContext({ timezoneId: 'Asia/Tokyo' })
  const page = await context.newPage()
  await page.clock.setFixedTime(new Date('2026-11-02T00:30:00+09:00'))
  await page.goto('/')
  await expect(page.getByText('Week 2 of 27 · Foundation')).toBeVisible()
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('5K test, baseline')
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
