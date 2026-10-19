import { readFile } from 'node:fs/promises'
import { expect, test } from '@playwright/test'
import { expectNoAxeViolations } from './axe'

/**
 * Logs one Session to the shared e2e database, in a Week no other test reads
 * (24 on the phone, 25 on desktop: after every other test's clock), then
 * exports from Settings and finds it in both files.
 */
const SCENARIO = {
  phone: { week: 24, date: '2027-04-06' },
  desktop: { week: 25, date: '2027-04-13' },
}

test('export from Settings holds a Session just logged, as JSON and as CSV', async ({ page, request }, testInfo) => {
  const { week, date } = SCENARIO[testInfo.project.name as keyof typeof SCENARIO]
  const id = `e2e-${testInfo.project.name}-export`
  const notes = `Export check, "${testInfo.project.name}"`
  const log = {
    id, week, sessionId: 'easy', date, status: 'done', minutes: 40, rpe: 4, notes,
    resultSeconds: null, environment: null, distanceMeters: null, intervals: [], stations: [], sets: [],
    updatedAt: `${date}T20:00:00.000Z`,
  }
  expect((await request.post('/api/sync', { data: { sessionLogs: [log] } })).ok()).toBe(true)

  await page.goto('/')
  await page.getByRole('button', { name: 'Settings' }).click()
  const settings = page.getByRole('dialog', { name: 'Settings' })
  await expect(settings.getByText('Your data')).toBeVisible()
  await expectNoAxeViolations(page)

  const [json] = await Promise.all([page.waitForEvent('download'), settings.getByRole('link', { name: 'Export JSON' }).click()])
  expect(json.suggestedFilename()).toMatch(/^compromised-\d{4}-\d{2}-\d{2}\.json$/)
  const exported = JSON.parse(await readFile(await json.path(), 'utf8'))
  expect(Object.keys(exported.tables)).toEqual(
    expect.arrayContaining(['session_logs', 'set_logs', 'pain_reports', 'recovery_nights', 'activities']),
  )
  expect(exported.tables.session_logs).toContainEqual(
    expect.objectContaining({ id, week, session_id: 'easy', date, status: 'done', minutes: 40, rpe: 4, notes }),
  )

  // A download, not a navigation: still on Today, Settings still open.
  await expect(page).toHaveURL('/')
  const [csv] = await Promise.all([page.waitForEvent('download'), settings.getByRole('link', { name: 'Export CSV' }).click()])
  expect(csv.suggestedFilename()).toMatch(/^compromised-\d{4}-\d{2}-\d{2}-csv\.zip$/)
  // Stored, not compressed, so each CSV is there as written.
  const zipped = (await readFile(await csv.path())).toString('utf8')
  expect(zipped).toContain('session_logs.csv')
  expect(zipped).toContain('id,week,session_id,date,status,minutes,rpe,notes,')
  expect(zipped).toContain(`${id},${week},easy,${date},done,40,4,"${notes.replace(/"/g, '""')}",`)
})
