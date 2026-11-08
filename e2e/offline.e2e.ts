import { expect, test, type Page } from '@playwright/test'
import { expectNoAxeViolations } from './axe'
import { caughtUp, caughtUpOnServer, seedLogs, serveHistory, weekDone } from './history'

/**
 * These tests write Session logs to the shared e2e database, so each project
 * gets a Week no other test reads: the phone logs in Week 9, desktop in Week 14,
 * each after a Week done in full by Thursday (8 and 13), too recent for a
 * re-entry, and every Week before caught up, so nothing is Late.
 */
const WEEK = { phone: 9, desktop: 14 } as Record<string, number>
const BEFORE = {
  9: weekDone(8, ['hyrox-a', 'hyrox-b', 'run', 'strength'], '2026-12-31'),
  14: weekDone(13, ['hyrox-a', 'hyrox-b', 'run', 'strength'], '2027-02-04'),
} as Record<number, ReturnType<typeof weekDone>>
/** Wednesday noon in Toronto of Week 9 (Mon 4 Jan) or Week 14 (Mon 8 Feb). */
const WEDNESDAY = { 9: new Date('2027-01-06T12:00:00-05:00'), 14: new Date('2027-02-10T12:00:00-05:00') } as Record<
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
  request,
}, testInfo) => {
  const week = WEEK[testInfo.project.name]
  await seedLogs(request, testInfo.project.name, BEFORE[week])
  const network = await caughtUpOnServer(page, week - 1)
  await page.clock.setFixedTime(WEDNESDAY[week])
  await page.goto('/')
  await shellCached(page)

  const upNext = page.getByRole('heading', { level: 1 })
  // The server's logs are in once nothing reads as behind.
  await expect(page.getByText(/ behind · Week /)).toHaveCount(0)
  const session = (await upNext.textContent())!.split(',')[0]
  const waiting = page.getByText('1 log on this phone, waiting to sync.')
  // This Week's row only: until a fresh browser has loaded the logs, every earlier Week's Sessions show as Late.
  const row = (p: Page) =>
    p
      .getByRole('list')
      .filter({ hasText: 'Strength' })
      .getByRole('listitem')
      .filter({ hasText: session, hasNotText: /Late/ })

  // In the gym: no signal. The log saves on the phone and Today moves on.
  await page.goto(`/log/${week}/${session.toLowerCase().replace(/ /g, '-')}`)
  await context.setOffline(true)
  network.offline = true
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

  // Signal again: it syncs on its own and the indicator goes quiet. The route opens
  // first, so the sync the `online` event starts isn't aborted (the next try is 30 s off).
  network.offline = false
  await context.setOffline(false)
  await expect(waiting).toBeHidden()

  // Another browser, which has never seen this phone, gets it from the server.
  const other = await browser.newContext()
  const elsewhere = await other.newPage()
  await caughtUpOnServer(elsewhere, week - 1)
  await elsewhere.clock.setFixedTime(WEDNESDAY[week])
  await elsewhere.goto('/')
  await expect(row(elsewhere)).toHaveText(new RegExp(`^${session}.*Done, Wed$`))
  await other.close()
})

test('the installed app opens offline on any screen', async ({ context, page, request }) => {
  // Week 2 done in full, kept on the phone from the first visit: Week 3 opens on its own Up next.
  await serveHistory(page, caughtUp(1, weekDone(2, ['hyrox-a', 'hyrox-b', 'compromised-run-test', 'strength'], '2026-11-16')))
  await page.clock.setFixedTime(new Date('2026-11-25T12:00:00-05:00'))
  await page.goto('/')
  await shellCached(page)

  await context.setOffline(true)
  await page.goto('/plan')
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Plan')
  await page.goto('/')
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(/^HYROX A, /)

  // Installable: a manifest whose icons are served.
  const manifest = await (await request.get('/manifest.webmanifest')).json()
  expect(manifest).toMatchObject({ start_url: '/', display: 'standalone' })
  for (const icon of manifest.icons) expect((await request.get(icon.src)).ok()).toBe(true)
})
