import { expect, test, type Page } from '@playwright/test'
import { expectNoAxeViolations, WEEK_3 } from './axe'

/**
 * These tests write Session logs to the shared e2e database, so each project
 * gets a Week no other test reads: the phone logs in Week 10, desktop in Week 11.
 */
const WEEK = { phone: 10, desktop: 11 } as Record<string, number>
/** Wednesday noon in Toronto of Week 10 (Mon 21 Dec) or Week 11 (Mon 28 Dec). */
const WEDNESDAY = { 10: new Date('2026-12-23T12:00:00-05:00'), 11: new Date('2026-12-30T12:00:00-05:00') } as Record<
  number,
  Date
>

/** Waits until the service worker has the app shell and controls the page. */
async function shellCached(page: Page) {
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready
    if (!navigator.serviceWorker.controller) {
      await new Promise((resolve) => navigator.serviceWorker.addEventListener('controllerchange', resolve, { once: true }))
    }
  })
}

test('a Session logged with no signal syncs once back online, and another browser sees it', async ({
  browser,
  context,
  page,
}, testInfo) => {
  const week = WEEK[testInfo.project.name]
  await page.clock.setFixedTime(WEDNESDAY[week])
  await page.goto('/')
  await shellCached(page)

  const upNext = page.getByRole('heading', { level: 1 })
  const session = (await upNext.textContent())!.split(',')[0]
  const waiting = page.getByText('1 log on this phone, waiting to sync.')
  const row = (p: Page) => p.getByRole('list').filter({ hasText: 'Strength' }).getByRole('listitem').filter({ hasText: session })

  // In the gym: no signal. The log saves on the phone and Today moves on.
  await context.setOffline(true)
  await page.getByRole('link', { name: 'Log after' }).click()
  await page.getByRole('radio', { name: '8', exact: true }).check({ force: true })
  await page.getByRole('button', { name: 'Save log' }).click()
  await expect(page).toHaveURL('/')
  await expect(row(page)).toHaveText(new RegExp(`^${session}.*Done, Wed$`))
  await expect(upNext).not.toHaveText(new RegExp(`^${session}, `))
  await expect(waiting).toBeVisible()
  await expectNoAxeViolations(page)

  // Still no signal: the app reopens from the phone with the log in place.
  await page.reload()
  await expect(row(page)).toHaveText(new RegExp(`^${session}.*Done, Wed$`))
  await expect(waiting).toBeVisible()

  // Signal again: it syncs on its own and the indicator goes quiet.
  await context.setOffline(false)
  await expect(waiting).toBeHidden()

  // Another browser, which has never seen this phone, gets it from the server.
  const other = await browser.newContext()
  const elsewhere = await other.newPage()
  await elsewhere.clock.setFixedTime(WEDNESDAY[week])
  await elsewhere.goto('/')
  await expect(row(elsewhere)).toHaveText(new RegExp(`^${session}.*Done, Wed$`))
  await other.close()
})

test('the installed app opens offline on any screen', async ({ context, page, request }) => {
  await page.clock.setFixedTime(WEEK_3)
  await page.goto('/')
  await shellCached(page)

  await context.setOffline(true)
  await page.goto('/plan')
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Plan')
  await page.goto('/')
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(/^Speed, /)

  // Installable: a manifest whose icons are served.
  const manifest = await (await request.get('/manifest.webmanifest')).json()
  expect(manifest).toMatchObject({ start_url: '/', display: 'standalone' })
  for (const icon of manifest.icons) expect((await request.get(icon.src)).ok()).toBe(true)
})
