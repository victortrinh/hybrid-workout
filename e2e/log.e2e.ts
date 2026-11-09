import { expect, test } from '@playwright/test'
import { expectNoAxeViolations } from './axe'
import { caughtUpOnServer, seedLogs, weekDone } from './history'

/**
 * These tests write Session logs to the shared e2e database, so each project
 * gets Weeks no other test reads: the phone logs in Week 4, desktop in Week 6,
 * each after a Week done in full (3 and 5), and every Week before caught up, so
 * nothing is Late. Week 3 is
 * done on its Saturday, after the clock of every test that reads Week 3.
 */
const BUCKET = ['hyrox-a', 'hyrox-b', 'run', 'strength']
const SCENARIO = {
  phone: {
    week: 4,
    before: weekDone(3, BUCKET, '2026-11-28'),
    wednesday: new Date('2026-12-02T12:00:00-05:00'),
    days: { wed: 'Wed 2 December', thu: 'Thu 3 December' },
  },
  desktop: {
    week: 6,
    before: weekDone(5, BUCKET, '2026-12-07'),
    wednesday: new Date('2026-12-16T12:00:00-05:00'),
    days: { wed: 'Wed 16 December', thu: 'Thu 17 December' },
  },
}

test('logging the Run as Done strikes it through on Today and changes Up next', async ({ page, request }, testInfo) => {
  const s = SCENARIO[testInfo.project.name as keyof typeof SCENARIO]
  const week = s.week
  await seedLogs(request, testInfo.project.name, s.before)
  await caughtUpOnServer(page, week - 1)
  await page.clock.setFixedTime(s.wednesday)
  await page.goto('/')

  const upNext = page.getByRole('heading', { level: 1 })
  const bucket = page.getByRole('list').filter({ hasText: 'Strength' })
  await expect(upNext).toHaveText(/^Strength, /)

  // A Session tapped in the Bucket, then Do it today instead, is today's; Strength goes back to planned.
  await expect(bucket.getByRole('button', { name: /^Run/ })).toHaveCount(1)
  await bucket.getByRole('button', { name: /^Run/ }).click()
  await page.getByRole('button', { name: /^Do it today/ }).click()
  await expect(upNext).toHaveText(/^Run, /)
  // Week 6 follows a Week done in full, so Build offers the second Easy run too.
  const easy = week >= 6 ? [/^Easy run.*Optional$/, /^Second Easy run.*Optional$/] : [/^Easy run.*Optional$/]
  await expect(bucket.getByRole('listitem')).toHaveText([/^Strength/, /^HYROX B/, /^Run.*Next$/, /^HYROX A/, ...easy])
  await expect(bucket.getByRole('listitem').first()).not.toContainText('Next')

  await page.goto(`/log/${week}/run`)
  await expect(page).toHaveURL(`/log/${week}/run`)
  await expect(page).toHaveTitle('Log after · Compromised')
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(/^Run, /)
  await expect(page.getByRole('radio', { name: 'Done' })).toBeChecked()
  await expect(page.getByRole('radio', { name: s.days.wed })).toBeChecked()
  await expect(page.getByRole('radio', { name: s.days.thu })).toBeDisabled()
  await expectNoAxeViolations(page)

  // The radios' inputs sit visually hidden under their labels.
  await page.getByRole('radio', { name: '7', exact: true }).check({ force: true })
  await page.getByRole('textbox', { name: 'Notes' }).fill('Held the pace on the last rep.')
  await page.getByRole('button', { name: 'Save log' }).click()

  // Back on Today: struck through, the day it was done, and a new Up next.
  await expect(page).toHaveURL('/')
  const threshold = bucket.getByRole('listitem').nth(2)
  await expect(threshold).toHaveText(/^Run.*Done, Wed$/)
  await expect(threshold.getByText('Run', { exact: true })).toHaveCSS('text-decoration-line', 'line-through')
  await expect(upNext).toHaveText(/^Strength, /)
  await expect(page.getByText('3 Sessions left · 5 days')).toBeVisible()
  await expectNoAxeViolations(page)

  // Stored in D1: it survives a reload and the API returns it.
  await page.reload()
  await expect(threshold).toHaveText(/^Run.*Done, Wed$/)
  const state = await (await request.get('/api/state')).json()
  expect(state.sessionLogs).toContainEqual(
    expect.objectContaining({
      week,
      sessionId: 'run',
      date: s.wednesday.toISOString().slice(0, 10),
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
  await expect(threshold).toHaveText(/^Run.*Partial$/)
})

test.describe('the sync endpoint', () => {
  /** Week 19 is read by no screen test; ids carry the project so the two runs don't collide. */
  const entry = (project: string, change: Record<string, unknown> = {}) => ({
    id: `e2e-sync-${project}`,
    week: 19,
    sessionId: project === 'phone' ? 'easy' : 'strength',
    date: '2027-03-17',
    status: 'done',
    minutes: 40,
    rpe: 8,
    notes: null,
    resultSeconds: null,
    environment: null,
    distanceMeters: null,
    recoveryPace: null,
    intervals: [],
    sets: [],
    stations: [],
    updatedAt: '2027-03-17T20:00:00.000Z',
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

    const later = entry(project, { status: 'partial', updatedAt: '2027-03-18T08:00:00.000Z' })
    expect(await mine(await sync(later))).toEqual([later])

    // An older edit arriving late changes nothing; replaying the same edit is harmless.
    expect(await mine(await sync(entry(project)))).toEqual([later])
    expect(await mine(await sync(later))).toEqual([later])
  })

  test('keeps a Live session’s console distance and reps with its log, replaced whole by a later edit', async ({
    request,
  }, testInfo) => {
    const id = `e2e-live-${testInfo.project.name}`
    const run = entry(testInfo.project.name, {
      id,
      sessionId: 'easy',
      environment: 'indoor',
      distanceMeters: 9400,
      intervals: [
        { block: 1, rep: 1, targetPace: 292, held: true, actualPace: null },
        { block: 3, rep: 2, targetPace: 292, held: false, actualPace: 298 },
      ],
    })
    const stored = async (log: Record<string, unknown>) => {
      const response = await request.post('/api/sync', { data: { sessionLogs: [log] } })
      expect(response.ok()).toBe(true)
      return (await response.json()).sessionLogs.filter((l: { id: string }) => l.id === id)
    }

    expect(await stored(run)).toEqual([run])
    // By-feel speeds: a rep with no target at the speed run, and the jogs' recovery pace.
    const byFeel = { block: 5, rep: 3, targetPace: null, held: false, actualPace: 257 }
    const edited = { ...run, recoveryPace: 600, intervals: [run.intervals[1], byFeel], updatedAt: '2027-03-18T08:00:00.000Z' }
    expect(await stored(edited)).toEqual([edited])
    // An older copy arriving late doesn't bring its reps back.
    expect(await stored(run)).toEqual([edited])
  })

  test('keeps a Strength session’s sets with its log, replaced whole by a later edit', async ({ request }, testInfo) => {
    const id = `e2e-lift-${testInfo.project.name}`
    const lifted = entry(testInfo.project.name, {
      id,
      sessionId: 'strength',
      sets: [
        { exercise: 0, set: 1, lift: 'back-squat', pounds: 185, reps: 5, rpe: 7 },
        { exercise: 0, set: 2, lift: 'back-squat', pounds: 190, reps: 4, rpe: 9 },
        { exercise: 5, set: 1, lift: null, pounds: null, reps: 8, rpe: 7 },
      ],
    })
    const stored = async (log: Record<string, unknown>) => {
      const response = await request.post('/api/sync', { data: { sessionLogs: [log] } })
      expect(response.ok()).toBe(true)
      return (await response.json()).sessionLogs.filter((l: { id: string }) => l.id === id)
    }

    expect(await stored(lifted)).toEqual([lifted])
    const edited = { ...lifted, sets: lifted.sets.slice(0, 1), updatedAt: '2027-03-18T08:00:00.000Z' }
    expect(await stored(edited)).toEqual([edited])
    // An older copy arriving late doesn't bring its sets back.
    expect(await stored(lifted)).toEqual([edited])
  })

  test('keeps a HYROX session’s Station logs with its log, replaced whole by a later edit', async ({ request }, testInfo) => {
    const id = `e2e-hyrox-${testInfo.project.name}`
    const circuit = entry(testInfo.project.name, {
      id,
      sessionId: 'hyrox-b',
      stations: [
        { round: 1, part: 'skierg', pounds: null, meters: 1000, reps: null, seconds: 245 },
        { round: 1, part: 'run', pounds: null, meters: 600, reps: null, seconds: 170 },
        { round: 2, part: 'burpee-broad-jumps', pounds: null, meters: 80, reps: null, seconds: 280 },
        { round: 2, part: 'run', pounds: null, meters: 600, reps: null, seconds: 181 },
      ],
    })
    const stored = async (log: Record<string, unknown>) => {
      const response = await request.post('/api/sync', { data: { sessionLogs: [log] } })
      expect(response.ok()).toBe(true)
      return (await response.json()).sessionLogs.filter((l: { id: string }) => l.id === id)
    }

    expect(await stored(circuit)).toEqual([circuit])
    const edited = { ...circuit, stations: circuit.stations.slice(0, 2), updatedAt: '2027-03-18T08:00:00.000Z' }
    expect(await stored(edited)).toEqual([edited])
    expect(await stored(circuit)).toEqual([edited])
  })

  test('refuses logs that are malformed or name no Session', async ({ request }, testInfo) => {
    const project = testInfo.project.name
    for (const sessionLogs of [
      'nope',
      [entry(project, { status: 'planned' })],
      [entry(project, { rpe: 12 })],
      [entry(project, { sessionId: 'yoga' })],
      [entry(project, { week: 25 })],
      // Only the race has a result time.
      [entry(project, { resultSeconds: 1380 })],
      // Only a run Session has reps.
      [entry(project, { sessionId: 'strength', intervals: [{ block: 1, rep: 1, targetPace: null, held: true, actualPace: null }] })],
      // Only a Strength session has sets, and only on the 5 lb step.
      [entry(project, { sessionId: 'easy', sets: [{ exercise: 0, set: 1, lift: 'back-squat', pounds: 185, reps: 5, rpe: 7 }] })],
      [entry(project, { sessionId: 'strength', sets: [{ exercise: 0, set: 1, lift: 'back-squat', pounds: 187, reps: 5, rpe: 7 }] })],
      // Only HYROX, a Race simulation and a Compromised run test have Station logs.
      [entry(project, { stations: [{ round: 1, part: 'round', pounds: null, meters: null, reps: null, seconds: 600 }] })],
    ]) {
      const response = await request.post('/api/sync', { data: { sessionLogs } })
      expect(response.status()).toBe(400)
    }
    expect((await request.post('/api/sync', { data: 'not json', headers: { 'content-type': 'text/plain' } })).status()).toBe(400)
  })
})
