import { expect, test } from '@playwright/test'
import { expectNoAxeViolations } from './axe'
import { caughtUpOnServer, seedLogs } from './history'

/**
 * Each project gets a pair of Weeks no other test reads: the phone trains
 * Week 10 (a Deload) through Thursday and comes back 7 days later in Week 11;
 * desktop does the same with Weeks 17 and 18, after the phone's.
 */
const SCENARIO = {
  phone: {
    before: 10,
    back: 11,
    logs: [
      { sessionId: 'hyrox-a', date: '2027-01-11', status: 'done' },
      { sessionId: 'strength', date: '2027-01-12', status: 'done' },
      { sessionId: 'run', date: '2027-01-13', status: 'done' },
      { sessionId: 'hyrox-b', date: '2027-01-14', status: 'partial' },
    ],
    thursday: '2027-01-21',
    heading: 'HYROX A, 4 rounds',
    full: '4 × (Station + 800 m)',
    lighter: '4 × (Station + 500 m)',
  },
  desktop: {
    before: 17,
    back: 18,
    logs: [
      { sessionId: 'hyrox-a', date: '2027-03-01', status: 'done' },
      { sessionId: 'strength', date: '2027-03-02', status: 'done' },
      { sessionId: 'run', date: '2027-03-03', status: 'done' },
      { sessionId: 'hyrox-b', date: '2027-03-04', status: 'partial' },
    ],
    thursday: '2027-03-11',
    heading: 'Race simulation, half B',
    full: '4 × (1 km + Station)',
    lighter: '4 × (700 m + Station)',
  },
} as const

test('7 days without training bring a lighter Week: Accept lightens it, Undo restores it', async ({ page, request }, testInfo) => {
  const s = SCENARIO[testInfo.project.name as keyof typeof SCENARIO]
  await seedLogs(
    request,
    testInfo.project.name,
    s.logs.map((l) => ({ ...l, week: s.before })),
  )
  await caughtUpOnServer(page, s.before)
  await page.clock.setFixedTime(new Date(`${s.thursday}T12:00:00-05:00`))
  await page.goto('/')

  const upNext = page.getByRole('heading', { level: 1 })
  const suggestion = page.getByRole('region', { name: 'Coach’s Suggestion' })
  const nextRow = page.getByRole('list').filter({ hasText: 'Strength' }).getByRole('listitem').first()
  const bare = (text: string) => text.replaceAll(' ', ' ')

  await expect(upNext).toHaveText(s.heading)
  await expect(nextRow).toContainText(bare(s.full))
  await expect(suggestion).toContainText(
    `Welcome back. Full volume now is how calves file complaints. The rest of Week ${s.back} goes 33% lighter.`,
  )
  await expect(suggestion).toContainText('7 days since your last Session')
  await expectNoAxeViolations(page)

  await suggestion.getByRole('button', { name: 'Accept' }).click()
  await expect(nextRow).toContainText(bare(s.lighter))
  await expect(suggestion).toContainText(`Done. The rest of Week ${s.back} is 33% lighter.`)
  await expectNoAxeViolations(page)

  // Stored and synced: it survives a reload and the API returns it.
  await page.reload()
  await expect(nextRow).toContainText(bare(s.lighter))
  const state = await (await request.get('/api/state')).json()
  expect(state.suggestionDecisions).toContainEqual(
    expect.objectContaining({ id: `re-entry-w${s.back}`, decision: 'accepted', date: s.thursday }),
  )

  await suggestion.getByRole('button', { name: 'Undo' }).click()
  await expect(nextRow).toContainText(bare(s.full))
  await expect(suggestion.getByRole('button', { name: 'Accept' })).toBeVisible()

  // Keep leaves the Week as written, and Undo brings the choice back.
  await suggestion.getByRole('button', { name: 'Keep full volume' }).click()
  await expect(suggestion).toContainText('Keeping full volume. Your call. Your calves.')
  await expect(nextRow).toContainText(bare(s.full))
  await suggestion.getByRole('button', { name: 'Undo' }).click()

  await page.reload()
  await expect(nextRow).toContainText(bare(s.full))
  await expect(suggestion.getByRole('button', { name: 'Accept' })).toBeVisible()
})

test.describe('the sync endpoint, for Suggestion decisions', () => {
  const decision = (project: string, change: Record<string, unknown> = {}) => ({
    id: `e2e-sync-decision-${project}`,
    decision: 'accepted',
    date: '2027-03-08',
    updatedAt: '2027-03-08T20:00:00.000Z',
    ...change,
  })

  test('upserts, keeping the later decision', async ({ request }, testInfo) => {
    const project = testInfo.project.name
    const sync = async (d: Record<string, unknown>) => {
      const response = await request.post('/api/sync', { data: { suggestionDecisions: [d] } })
      expect(response.ok()).toBe(true)
      return (await response.json()).suggestionDecisions.filter((x: { id: string }) => x.id === d.id)
    }
    expect(await sync(decision(project))).toEqual([decision(project)])
    const undone = decision(project, { decision: 'open', updatedAt: '2027-03-08T20:00:00.001Z' })
    expect(await sync(undone)).toEqual([undone])
    expect(await sync(decision(project))).toEqual([undone])
  })

  test('refuses malformed decisions', async ({ request }, testInfo) => {
    const project = testInfo.project.name
    for (const suggestionDecisions of [
      'nope',
      [decision(project, { decision: 'maybe' })],
      [decision(project, { id: 'Not An Id' })],
      [decision(project, { date: '2027-02-30' })],
    ]) {
      expect((await request.post('/api/sync', { data: { suggestionDecisions } })).status()).toBe(400)
    }
  })
})
