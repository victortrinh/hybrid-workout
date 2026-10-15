import { expect, test } from '@playwright/test'
import { expectNoAxeViolations } from './axe'
import { seedLogs } from './history'
import { E2E_SERVICE_TOKEN, serviceTokenHeaders } from './serviceToken'

/**
 * Apple Watch workouts from the Workout Shortcut (ADR-0004), matched to
 * Sessions by the Coach. The first tests go through the real Worker and D1 on
 * Week 16, which no other test reads (Week 15 is the offline test's, so it
 * stays unseeded; by Friday nothing of it is carried): both projects post the same workouts,
 * which the endpoint takes idempotently, and neither answers anything. The
 * answering test serves its own state, so it never touches the shared database.
 */
const FRIDAY_WEEK_16 = new Date('2027-02-05T12:00:00-05:00')

const OUTDOOR_RUN = {
  type: 'Running',
  start: '2027-02-02T07:00:00-05:00',
  end: '2027-02-02T07:45:00-05:00',
  // The watch and the phone both measured it: only the watch's 8 km counts.
  distanceSamples: '4.00 km Victor’s Apple Watch\n4.00 km Victor’s Apple Watch\n7.20 km Victor’s iPhone',
  heartRates: '150\n155\n160',
  // February is a treadmill month in the default Settings: the Shortcut says this one wasn't.
  indoor: false,
}
const TREADMILL_RUN = {
  type: 'Running',
  start: '2027-02-04T18:00:00-05:00',
  end: '2027-02-04T18:40:00-05:00',
  distance: '6.10 km',
  heartRates: '145\n150\n155',
  indoor: true,
}

test('the activities endpoint only takes the Access service token, and a good workout', async ({ request }) => {
  expect((await request.post('/api/activities', { data: OUTDOOR_RUN })).status()).toBe(401)
  const wrong = await request.post('/api/activities', {
    data: OUTDOOR_RUN,
    headers: serviceTokenHeaders({ ...E2E_SERVICE_TOKEN, secret: 'not-it' }),
  })
  expect(wrong.status()).toBe(401)
  const bad = await request.post('/api/activities', {
    data: { ...OUTDOOR_RUN, end: '2027-02-02T06:00:00-05:00' },
    headers: serviceTokenHeaders(),
  })
  expect(bad.status()).toBe(400)
})

test('workouts sent by the Shortcut attach to the day’s Sessions; a treadmill one asks for the console distance', async ({
  page,
  request,
}, testInfo) => {
  const project = testInfo.project.name
  await seedLogs(request, project, [
    { week: 16, sessionId: 'speed', date: '2027-02-02', status: 'done' },
    { week: 16, sessionId: 'easy-deload', date: '2027-02-04', status: 'done' },
  ])
  for (const workout of [OUTDOOR_RUN, TREADMILL_RUN]) {
    const response = await request.post('/api/activities', { data: workout, headers: serviceTokenHeaders() })
    expect(response.status(), await response.text()).toBe(200)
  }
  // The Shortcut sending the same workout twice changes nothing.
  expect((await request.post('/api/activities', { data: OUTDOOR_RUN, headers: serviceTokenHeaders() })).status()).toBe(200)
  const state = await (await request.get('/api/state')).json()
  expect(state.activities.filter((a: { id: string }) => a.id === '2027-02-02T12:00:00Z')).toHaveLength(1)

  await page.clock.setFixedTime(FRIDAY_WEEK_16)
  await page.goto('/')

  const week = page.getByRole('list').filter({ hasText: 'Speed' }).first()
  await expect(week.getByRole('listitem').filter({ hasText: 'Watch, Tue: 45 min · 8.00 km · avg 155 bpm' })).toContainText(
    'Speed',
  )
  // On the treadmill: time and heart rate, never the watch's guess at distance.
  await expect(week.getByText('Watch, Thu: 40 min · avg 150 bpm')).toBeVisible()
  const ask = page.getByRole('region', { name: 'Console distance' })
  await expect(ask).toContainText('Easy run on the treadmill, Thu. What did the console say?')
  await expect(ask.getByRole('link', { name: 'Add console distance' })).toBeVisible()
  await expect(page.getByRole('region', { name: 'Which Session was this?' })).toHaveCount(0)
  await expectNoAxeViolations(page)
})

/** Week 18, served: Speed, Threshold and an Easy run all Planned, so a run fits all three. */
const WEDNESDAY_WEEK_18 = new Date('2027-02-17T12:00:00-05:00')
const AMBIGUOUS = {
  id: '2027-02-17T12:00:00Z',
  date: '2027-02-17',
  startedAt: '2027-02-17T12:00:00Z',
  workoutType: 'Running',
  kind: 'run',
  minutes: 42,
  distanceMeters: 7900,
  averageHeartRate: 152,
  maxHeartRate: 171,
  indoor: true,
  receivedAt: '2027-02-17T13:00:00.000Z',
}

test('Today asks which Session an ambiguous workout was; the answer attaches it, then the console distance is logged', async ({
  page,
}) => {
  const logs: Record<string, unknown>[] = []
  const answers: Record<string, unknown>[] = []
  await page.route(/\/api\/(state|sync)$/, (route) => {
    if (route.request().method() === 'POST') {
      const body = route.request().postDataJSON()
      logs.push(...(body.sessionLogs ?? []))
      answers.push(...(body.activityAnswers ?? []))
    }
    return route.fulfill({
      json: {
        sessionLogs: [
          ...['5k-test', 'strength', 'threshold', 'hyrox'].map((sessionId) => ({
            id: `served-w17-${sessionId}`,
            week: 17,
            sessionId,
            date: '2027-02-13',
            status: 'done',
            minutes: 45,
            rpe: 6,
            notes: null,
            resultSeconds: null,
            environment: null,
            distanceMeters: null,
            intervals: [],
            stations: [],
            sets: [],
            updatedAt: '2027-02-13T20:00:00.000Z',
          })),
          ...logs,
        ],
        suggestionDecisions: [],
        painReports: [],
        activities: [AMBIGUOUS],
        activityAnswers: answers,
      },
    })
  })
  await page.clock.setFixedTime(WEDNESDAY_WEEK_18)
  await page.goto('/')

  const question = page.getByRole('region', { name: 'Which Session was this?' })
  await expect(question).toContainText('Running from the watch, Wed 7:00 · 42 min · avg 152 bpm')
  await expect(question.getByRole('button')).toHaveText(['Speed', 'Threshold', 'Easy run', 'None of these'])
  await expectNoAxeViolations(page)

  await question.getByRole('button', { name: 'Threshold' }).click()
  await expect(question).toHaveCount(0)
  expect(answers).toMatchObject([{ activityId: AMBIGUOUS.id, week: 18, sessionId: 'threshold' }])
  await expect(page.getByText('Watch, Wed: 42 min · avg 152 bpm')).toBeVisible()

  // Attached, not logged: Today offers Log it, which asks for the treadmill console's distance.
  const attached = page.getByRole('region', { name: 'From the watch' })
  await expect(attached).toContainText('Threshold it was. Not logged yet.')
  await expect(attached).toContainText('Bring the console’s distance.')
  await expect(page.getByRole('region', { name: 'Console distance' })).toHaveCount(0)
  await attached.getByRole('link', { name: 'Log it' }).click()
  await expect(page).toHaveURL('/log/18/threshold')
  const watch = page.getByRole('region', { name: 'From the watch' })
  await expect(watch).toContainText('Running, Wed 17 February at 7:00')
  await expect(watch).toContainText('It guessed 7.90 km. Treadmill: the console’s distance counts.')
  await expect(page.getByRole('textbox', { name: 'Duration, minutes' })).toHaveValue('42')
  await page.getByRole('textbox', { name: 'Console distance, km' }).fill('8.4')
  await page.getByRole('radio', { name: '7', exact: true }).check({ force: true })
  await page.getByRole('radio', { name: 'No', exact: true }).check({ force: true })
  await page.getByRole('button', { name: 'Save log' }).click()

  await expect(page).toHaveURL('/')
  await expect.poll(() => logs.at(-1)).toMatchObject({ week: 18, sessionId: 'threshold', minutes: 42, distanceMeters: 8400 })
  await expect(page.getByRole('region', { name: 'Console distance' })).toHaveCount(0)
  await expect(page.getByRole('region', { name: 'From the watch' })).toHaveCount(0)
})

test('Settings has the Workout Shortcut setup page, with the address and the steps', async ({ page }) => {
  await page.clock.setFixedTime(FRIDAY_WEEK_16)
  await page.goto('/')
  await page.getByRole('button', { name: 'Settings' }).click()
  await page.getByRole('link', { name: 'Workout Shortcut setup' }).click()

  await expect(page).toHaveURL('/settings/workouts')
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Workout Shortcut')
  await expect(page.getByText(new URL('/api/activities', page.url()).href)).toBeVisible()
  await expect(page.getByRole('list').filter({ hasText: 'Find Health Samples' }).getByRole('listitem')).toHaveCount(8)
  await expectNoAxeViolations(page)
})
