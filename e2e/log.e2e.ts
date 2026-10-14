import { expect, test } from '@playwright/test'
import { expectNoAxeViolations } from './axe'

/**
 * These tests write Session logs to the shared e2e database, so each project
 * gets Weeks no other test reads: the phone logs in Week 5, desktop in Week 6.
 */
const WEEK = { phone: 5, desktop: 6 } as Record<string, number>
/** Wednesday noon in Toronto of Week 5 (Mon 16 Nov) or Week 6 (Mon 23 Nov). */
const WEDNESDAY = { 5: new Date('2026-11-18T12:00:00-05:00'), 6: new Date('2026-11-25T12:00:00-05:00') } as Record<
  number,
  Date
>

test('logging Threshold as Done strikes it through on Today and changes Up next', async ({ page, request }, testInfo) => {
  const week = WEEK[testInfo.project.name]
  await page.clock.setFixedTime(WEDNESDAY[week])
  await page.goto('/')

  const upNext = page.getByRole('heading', { level: 1 })
  const bucket = page.getByRole('list').filter({ hasText: 'Strength' })
  await expect(upNext).toHaveText(/^Speed, /)

  // Tapping a Session in the Bucket makes it today's; Speed goes back to planned.
  await bucket.getByRole('button', { name: /^Threshold/ }).click()
  await expect(upNext).toHaveText(/^Threshold, /)
  await expect(bucket.getByRole('listitem')).toHaveText([/^Speed/, /^Strength/, /^Threshold.*Next$/, /^HYROX/, /^Easy run.*Optional$/])
  await expect(bucket.getByRole('listitem').first()).not.toContainText('Next')

  await page.getByRole('link', { name: 'Log after' }).click()
  await expect(page).toHaveURL(`/log/${week}/threshold`)
  await expect(page).toHaveTitle('Log after · Compromised')
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(/^Threshold, /)
  await expect(page.getByRole('heading', { level: 1 })).toBeFocused()
  await expect(page.getByRole('radio', { name: 'Done' })).toBeChecked()
  await expect(page.getByRole('radio', { name: /^Wed / })).toBeChecked()
  await expect(page.getByRole('radio', { name: /^Thu / })).toBeDisabled()
  await expectNoAxeViolations(page)

  // The radios' inputs sit visually hidden under their labels.
  await page.getByRole('radio', { name: '7', exact: true }).check({ force: true })
  await page.getByRole('textbox', { name: 'Notes' }).fill('Held the pace on the last rep.')
  await page.getByRole('button', { name: 'Save log' }).click()

  // Back on Today: struck through, the day it was done, and a new Up next.
  await expect(page).toHaveURL('/')
  const threshold = bucket.getByRole('listitem').nth(2)
  await expect(threshold).toHaveText(/^Threshold.*Done, Wed$/)
  await expect(threshold.getByText('Threshold', { exact: true })).toHaveCSS('text-decoration-line', 'line-through')
  await expect(upNext).toHaveText(/^Speed, /)
  await expect(page.getByText('3 Sessions left · 5 days')).toBeVisible()
  await expectNoAxeViolations(page)

  // Stored in D1: it survives a reload and the API returns it.
  await page.reload()
  await expect(threshold).toHaveText(/^Threshold.*Done, Wed$/)
  const state = await (await request.get('/api/state')).json()
  expect(state.sessionLogs).toContainEqual(
    expect.objectContaining({
      week,
      sessionId: 'threshold',
      date: WEDNESDAY[week].toISOString().slice(0, 10),
      status: 'done',
      minutes: 45,
      rpe: 7,
      notes: 'Held the pace on the last rep.',
    }),
  )

  // A logged row opens its log to edit.
  await threshold.getByRole('link').click()
  await expect(page.getByText(`Edit log · Week ${week}`)).toBeVisible()
  await page.getByRole('radio', { name: 'Partial' }).check({ force: true })
  await page.getByRole('button', { name: 'Save log' }).click()
  await expect(threshold).toHaveText(/^Threshold.*Partial$/)
})

test.describe('the sync endpoint', () => {
  /** Week 20 is read by no screen test; ids carry the project so the two runs don't collide. */
  const entry = (project: string, change: Record<string, unknown> = {}) => ({
    id: `e2e-sync-${project}`,
    week: 20,
    sessionId: project === 'phone' ? 'speed' : 'strength',
    date: '2027-03-08',
    status: 'done',
    minutes: 40,
    rpe: 8,
    notes: null,
    resultSeconds: null,
    environment: null,
    updatedAt: '2027-03-08T20:00:00.000Z',
    ...change,
  })

  test('upserts with client ids, keeping the later edit', async ({ request }, testInfo) => {
    const project = testInfo.project.name
    const sync = (log: Record<string, unknown>) => request.post('/api/sync', { data: { sessionLogs: [log] } })
    const mine = async (response: Awaited<ReturnType<typeof sync>>) => {
      expect(response.ok()).toBe(true)
      const body = await response.json()
      return body.sessionLogs.filter((l: { id: string }) => l.id === `e2e-sync-${project}`)
    }

    expect(await mine(await sync(entry(project)))).toEqual([entry(project)])

    const later = entry(project, { status: 'partial', updatedAt: '2027-03-09T08:00:00.000Z' })
    expect(await mine(await sync(later))).toEqual([later])

    // An older edit arriving late changes nothing; replaying the same edit is harmless.
    expect(await mine(await sync(entry(project)))).toEqual([later])
    expect(await mine(await sync(later))).toEqual([later])
  })

  test('refuses logs that are malformed or name no Session', async ({ request }, testInfo) => {
    const project = testInfo.project.name
    for (const sessionLogs of [
      'nope',
      [entry(project, { status: 'planned' })],
      [entry(project, { rpe: 12 })],
      [entry(project, { sessionId: 'yoga' })],
      [entry(project, { week: 28 })],
      // Only a 5K test has a result time.
      [entry(project, { resultSeconds: 1380 })],
    ]) {
      const response = await request.post('/api/sync', { data: { sessionLogs } })
      expect(response.status()).toBe(400)
    }
    expect((await request.post('/api/sync', { data: 'not json', headers: { 'content-type': 'text/plain' } })).status()).toBe(400)
  })
})
