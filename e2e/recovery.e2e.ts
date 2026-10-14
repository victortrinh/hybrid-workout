import { expect, test } from '@playwright/test'
import { expectNoAxeViolations } from './axe'
import { seedLogs, weekDone } from './history'
import { E2E_SERVICE_TOKEN, serviceTokenHeaders } from './serviceToken'

/**
 * Recovery data from the morning Shortcut, through the real Worker and D1.
 * Weeks 22 and 23 are read by no other test: Week 22 is done in full, so
 * Wednesday of Week 23 has Speed, 4 × 3′ Up next. Both projects send the
 * same nights, which the endpoint takes idempotently, and neither decides
 * the Suggestion, so they can run side by side.
 */
const WEDNESDAY = new Date('2027-03-24T12:00:00-04:00')

/** A normal week of nights, HRV averaging 52, then a short one with HRV 27% down. */
const NIGHTS = [
  ...['2027-03-17', '2027-03-18', '2027-03-19', '2027-03-20', '2027-03-21', '2027-03-22', '2027-03-23'].map((date, i) => ({
    date,
    sleepMinutes: 450,
    hrvMs: [50, 54, 52, 51, 53, 52, 52][i],
    restingHeartRate: 48,
    source: 'Ultrahuman',
  })),
  { date: '2027-03-24', sleepMinutes: 341, hrvMs: 38, restingHeartRate: 52, source: 'Ultrahuman' },
]

test('the recovery endpoint only takes the Access service token', async ({ request }) => {
  const night = NIGHTS[0]
  expect((await request.post('/api/recovery', { data: night })).status()).toBe(401)
  const wrong = await request.post('/api/recovery', {
    data: night,
    headers: serviceTokenHeaders({ ...E2E_SERVICE_TOKEN, secret: 'not-it' }),
  })
  expect(wrong.status()).toBe(401)
  const idOnly = await request.post('/api/recovery', {
    data: night,
    headers: { 'CF-Access-Client-Id': E2E_SERVICE_TOKEN.id },
  })
  expect(idOnly.status()).toBe(401)

  const bad = await request.post('/api/recovery', { data: { ...night, date: '24/03/2027' }, headers: serviceTokenHeaders() })
  expect(bad.status()).toBe(400)
})

test('a short night with low HRV, sent by the Shortcut, shows on Today with its numbers', async ({ page, request }, testInfo) => {
  await seedLogs(request, testInfo.project.name, weekDone(22, ['speed', 'strength', 'easy-deload', 'hyrox'], '2027-03-20'))
  for (const night of NIGHTS) {
    const response = await request.post('/api/recovery', { data: night, headers: serviceTokenHeaders() })
    expect(response.status(), await response.text()).toBe(200)
  }
  // The Shortcut running twice the same morning changes nothing.
  const again = await request.post('/api/recovery', { data: NIGHTS.at(-1), headers: serviceTokenHeaders() })
  expect(again.status()).toBe(200)
  const state = await (await request.get('/api/state')).json()
  expect(state.recoveryNights.filter((n: { date: string }) => n.date === '2027-03-24')).toHaveLength(1)

  await page.clock.setFixedTime(WEDNESDAY)
  await page.goto('/')

  // Short sleep: one rep fewer, RPE capped.
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Speed, 3 × 3′')
  await expect(page.getByText('Slept 5 h 41. Bold of you. One fewer rep, nothing past RPE 7.')).toBeVisible()

  // Low HRV on top: the Suggestion, with the numbers that triggered it.
  const suggestion = page.getByRole('region', { name: 'Coach’s Suggestion' }).filter({ hasText: 'HRV' })
  await expect(suggestion).toContainText('Slept 5 h 41 and HRV is down 27%.')
  await expect(suggestion).toContainText('Sleep 5 h 41 · HRV 38 ms against a 52 ms average')
  await expect(suggestion.getByRole('button', { name: 'Keep it, one rep fewer' })).toBeVisible()
  await expectNoAxeViolations(page)
})

test('Settings has the Shortcut setup page, with the address and the headers', async ({ page }) => {
  await page.clock.setFixedTime(WEDNESDAY)
  await page.goto('/')
  await page.getByRole('button', { name: 'Settings' }).click()
  await page.getByRole('link', { name: 'Recovery Shortcut setup' }).click()

  await expect(page).toHaveURL('/settings/shortcut')
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Recovery Shortcut')
  await expect(page.getByText(new URL('/api/recovery', page.url()).href)).toBeVisible()
  await expect(page.getByText('CF-Access-Client-Id', { exact: true })).toBeVisible()
  await expect(page.getByText('CF-Access-Client-Secret', { exact: true })).toBeVisible()
  await expect(page.getByRole('list').filter({ hasText: 'Find Health Samples' }).getByRole('listitem')).toHaveCount(8)
  await expectNoAxeViolations(page)
})
