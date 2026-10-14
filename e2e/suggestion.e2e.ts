import { expect, test } from '@playwright/test'
import { expectNoAxeViolations } from './axe'
import { seedLogs } from './history'

/**
 * Each project gets a pair of Weeks no other test reads: the phone skips two
 * Sessions in Week 10 and comes back in Week 11; desktop in Weeks 13 and 14.
 */
const SCENARIO = {
  phone: { skipped: 10, back: 11, monday: '2026-12-21', tuesday: '2026-12-29', speed: '4 × 4′', lighter: '3 × 4′' },
  desktop: { skipped: 13, back: 14, monday: '2027-01-11', tuesday: '2027-01-19', speed: '6 × 2′', lighter: '4 × 2′' },
} as const

test('two Skipped Sessions bring a lighter Week: Accept lightens it, Undo restores it', async ({ page, request }, testInfo) => {
  const s = SCENARIO[testInfo.project.name as keyof typeof SCENARIO]
  const day = (offset: number) => s.monday.slice(0, 8) + String(Number(s.monday.slice(8)) + offset).padStart(2, '0')
  await seedLogs(request, testInfo.project.name, [
    { week: s.skipped, sessionId: 'speed', date: day(0), status: 'done' },
    { week: s.skipped, sessionId: 'strength', date: day(1), status: 'done' },
    { week: s.skipped, sessionId: 'threshold', date: day(2), status: 'skipped' },
    { week: s.skipped, sessionId: 'hyrox', date: day(3), status: 'skipped' },
  ])
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
  await expect(suggestion).toContainText(`Week ${s.skipped}: Threshold and HYROX skipped`)
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
