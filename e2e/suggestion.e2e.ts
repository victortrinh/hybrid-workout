import { expect, test } from '@playwright/test'
import { expectNoAxeViolations } from './axe'
import { seedLogs } from './history'

/**
 * Each project gets a pair of Weeks no other test reads: the phone skips two
 * Sessions in Week 12 (a Deload) and comes back in Week 13; desktop skips in
 * Week 18 and comes back in Week 19.
 */
const SCENARIO = {
  phone: {
    skipped: 12,
    back: 13,
    logs: [
      { sessionId: 'speed', date: '2027-01-04', status: 'done' },
      { sessionId: 'strength', date: '2027-01-05', status: 'done' },
      { sessionId: 'easy-deload', date: '2027-01-06', status: 'skipped' },
      { sessionId: 'hyrox', date: '2027-01-07', status: 'skipped' },
    ],
    names: 'Easy run and HYROX',
    tuesday: '2027-01-12',
    speed: '3 × 5′',
    lighter: '2 × 5′',
  },
  desktop: {
    skipped: 18,
    back: 19,
    logs: [
      { sessionId: 'speed', date: '2027-02-15', status: 'done' },
      { sessionId: 'strength', date: '2027-02-16', status: 'skipped' },
      { sessionId: 'threshold', date: '2027-02-17', status: 'skipped' },
      { sessionId: 'race-simulation', date: '2027-02-18', status: 'done' },
    ],
    names: 'Strength and Threshold',
    tuesday: '2027-02-23',
    speed: '5 × 3′',
    lighter: '3 × 3′',
  },
} as const

test('two Skipped Sessions bring a lighter Week: Accept lightens it, Undo restores it', async ({ page, request }, testInfo) => {
  const s = SCENARIO[testInfo.project.name as keyof typeof SCENARIO]
  await seedLogs(
    request,
    testInfo.project.name,
    s.logs.map((l) => ({ ...l, week: s.skipped })),
  )
  await page.clock.setFixedTime(new Date(`${s.tuesday}T12:00:00-05:00`))
  await page.goto('/')

  const upNext = page.getByRole('heading', { level: 1 })
  const suggestion = page.getByRole('region', { name: 'Coach’s Suggestion' })
  const speedRow = page.getByRole('list').filter({ hasText: 'Strength' }).getByRole('listitem').first()
  const bare = (text: string) => text.replaceAll(' ', ' ')

  await expect(upNext).toHaveText(`Speed, ${s.speed}`)
  await expect(suggestion).toContainText(
    `2 Sessions skipped last Week. Full volume now is how calves file complaints. Week ${s.back} goes 33% lighter.`,
  )
  await expect(suggestion).toContainText(`Week ${s.skipped}: ${s.names} skipped`)
  await expectNoAxeViolations(page)

  await suggestion.getByRole('button', { name: 'Accept' }).click()
  await expect(upNext).toHaveText(`Speed, ${s.lighter}`)
  await expect(speedRow).toContainText(bare(s.lighter))
  await expect(suggestion).toContainText(`Done. Week ${s.back} is 33% lighter.`)
  await expectNoAxeViolations(page)

  // Stored and synced: it survives a reload and the API returns it.
  await page.reload()
  await expect(upNext).toHaveText(`Speed, ${s.lighter}`)
  const state = await (await request.get('/api/state')).json()
  expect(state.suggestionDecisions).toContainEqual(
    expect.objectContaining({ id: `re-entry-w${s.back}`, decision: 'accepted', date: s.tuesday }),
  )

  await suggestion.getByRole('button', { name: 'Undo' }).click()
  await expect(upNext).toHaveText(`Speed, ${s.speed}`)
  await expect(suggestion.getByRole('button', { name: 'Accept' })).toBeVisible()

  // Keep leaves the Week as written, and Undo brings the choice back.
  await suggestion.getByRole('button', { name: 'Keep full volume' }).click()
  await expect(suggestion).toContainText('Keeping full volume. Your call. Your calves.')
  await expect(upNext).toHaveText(`Speed, ${s.speed}`)
  await suggestion.getByRole('button', { name: 'Undo' }).click()

  await page.reload()
  await expect(upNext).toHaveText(`Speed, ${s.speed}`)
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
