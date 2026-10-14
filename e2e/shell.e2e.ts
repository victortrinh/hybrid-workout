import { expect, test } from '@playwright/test'
import { expectNoAxeViolations, WEEK_3 } from './axe'
import { serveHistory, weekDone } from './history'

test.beforeEach(async ({ page }) => {
  // Week 2 done in full, so Today opens on Week 3's own Up next.
  await serveHistory(page, weekDone(2, ['5k-test', 'strength', 'threshold', 'hyrox'], '2026-10-26'))
  await page.clock.setFixedTime(WEEK_3)
})

test('phones get the bottom tab bar, desktop gets the cobalt side rail', async ({ page }, testInfo) => {
  await page.goto('/')
  const nav = page.getByRole('navigation', { name: 'Main' })
  await expect(nav).toHaveCount(1)
  await expect(nav.getByRole('link')).toHaveText(['Today', 'Plan', 'Progress'])
  await expect(nav.getByRole('link', { name: 'Today' })).toHaveAttribute('aria-current', 'page')

  const box = (await nav.boundingBox())!
  if (testInfo.project.name === 'phone') {
    expect(box.y + box.height).toBeCloseTo(844, 0)
    expect(box.width).toBe(390)
  } else {
    expect(box.x).toBeLessThan(240)
    await expect(page.locator('aside')).toHaveCSS('background-color', 'rgb(27, 59, 184)')
  }
})

for (const colorScheme of ['light', 'dark'] as const) {
  test(`Plan shows the Weeks and Progress an honest empty state, ${colorScheme}`, async ({ page }) => {
    await page.emulateMedia({ colorScheme })
    // Nothing logged at all: Progress has nothing to chart.
    await serveHistory(page, [])
    await page.goto('/')

    await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Plan' }).click()
    await expect(page).toHaveURL('/plan')
    await expect(page).toHaveTitle('Plan · Compromised')
    await expect(page.getByRole('heading', { level: 1, name: 'Plan' })).toBeFocused()
    await expect(page.getByRole('heading', { level: 2, name: /^Foundation/ })).toBeVisible()
    await expectNoAxeViolations(page)

    await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Progress' }).click()
    await expect(page).toHaveURL('/progress')
    await expect(page.getByRole('heading', { level: 1, name: 'Progress' })).toBeFocused()
    await expect(page.getByText('Nothing logged yet, so nothing to chart.')).toBeVisible()
    await expectNoAxeViolations(page)
  })
}

test('deep links load on refresh, and unknown paths say so', async ({ page }) => {
  await page.goto('/progress')
  await expect(page.getByRole('heading', { level: 1, name: 'Progress' })).toBeVisible()
  await page.goto('/nowhere')
  await expect(page.getByRole('heading', { level: 1, name: 'Nothing here.' })).toBeVisible()
  await page.getByRole('link', { name: 'Back to Today' }).click()
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Speed, 5 × 3′')
})

test('the Worker answers the API with D1 bound', async ({ request }) => {
  const health = await request.get('/api/health')
  expect(health.ok()).toBe(true)
  expect(await health.json()).toEqual({ ok: true, db: true })

  const missing = await request.get('/api/nope')
  expect(missing.status()).toBe(404)
})

test('Archivo is self-hosted: no request leaves for Google Fonts', async ({ page, baseURL }) => {
  const fontRequests: string[] = []
  page.on('request', (req) => {
    if (req.resourceType() === 'font' || /fonts\.(googleapis|gstatic)\.com/.test(req.url())) fontRequests.push(req.url())
  })
  await page.goto('/')
  const loaded = await page.evaluate(async () => {
    await document.fonts.ready
    return [...document.fonts].filter((f) => f.status === 'loaded').map((f) => `${f.family} ${f.stretch}`)
  })

  expect(loaded).toContain('Archivo Variable 62% 125%')
  expect(fontRequests.length).toBeGreaterThan(0)
  for (const url of fontRequests) expect(url.startsWith(`${baseURL}/assets/`)).toBe(true)
})
