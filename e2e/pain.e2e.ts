import { expect, test, type Locator, type Page } from '@playwright/test'
import { expectNoAxeViolations, WEEK_3 } from './axe'
import { serveHistory, weekDone } from './history'

/**
 * Pain reports and the pain rules. The server is stood in for, so nothing
 * here touches the shared database; Week 2 is done with a 23:00 5K test on
 * the treadmill, so Wednesday of Week 3 has Speed, 5 × 3′ Up next.
 */
/**
 * Picks a toggle by its label. The radio's input sits visually hidden under
 * it; clicking the label lets Playwright scroll it clear of the tab bar.
 */
const pick = (scope: Page | Locator, name: string) =>
  scope.locator('label').filter({ hasText: new RegExp(`^${name}$`) }).click()

const WEEK_2 = [
  { week: 2, sessionId: '5k-test', date: '2026-10-27', status: 'done', resultSeconds: 23 * 60, environment: 'indoor' },
  ...weekDone(2, ['strength', 'threshold', 'hyrox'], '2026-10-28'),
] as const

/** Shin 2 from Monday, outside any Session: still standing on Wednesday. */
const SHIN_2 = {
  id: 'seed-shin-2',
  date: '2026-11-02',
  score: 2,
  area: 'shin',
  week: null,
  sessionId: null,
  updatedAt: '2026-11-02T12:00:00.000Z',
}

test('pain 4 before a Speed session: the accelerations go to the bike and the reps drop', async ({ page }) => {
  const reports: Record<string, unknown>[] = [SHIN_2]
  await serveHistory(page, [...WEEK_2], reports)
  await page.clock.setFixedTime(WEEK_3)
  await page.goto('/')

  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Speed, 5 × 3′')
  await page.getByRole('button', { name: /^Start / }).click()

  // Pain stands, so Start asks whether it still does, with Gone one tap away.
  const step = page.getByRole('region', { name: 'Up next' })
  await expect(step).toContainText('Shin 2 last time.')
  await expect(step.getByRole('button', { name: 'Gone' })).toBeFocused()
  await step.getByRole('button', { name: 'Changed' }).click()
  await pick(step, '4')
  await pick(step, 'Achilles / calf')
  await expect(step).toContainText('Pain 4 and rising. No jumps, fewer reps, before it gets a vote.')
  await expectNoAxeViolations(page)
  await step.getByRole('button', { name: 'Start with that' }).click()

  // The Live session has it already: bike sprints for the jumps and accelerations, four reps for five.
  await expect(page).toHaveURL('/live')
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Speed, 4 × 3′')
  const blocks = page.getByRole('list', { name: 'Blocks' }).getByRole('listitem')
  await expect(blocks).toHaveText([
    /^Warm-up/,
    /^Bike sprints/,
    /^Bike sprints/,
    /^Rep 1 of 4/,
    /^Jog/,
    /^Rep 2 of 4/,
    /^Jog/,
    /^Rep 3 of 4/,
    /^Jog/,
    /^Rep 4 of 4/,
    /^Cooldown/,
  ])
  await expect(blocks.filter({ hasText: 'Accelerations' })).toHaveCount(0)

  await expect.poll(() => reports.at(-1)).toMatchObject({
    date: '2026-11-04',
    score: 4,
    area: 'achilles-calf',
    week: 3,
    sessionId: 'speed',
  })
})

test('with nothing hurting on record, Start is one tap and starts the Session as written', async ({ page }) => {
  const reports: Record<string, unknown>[] = []
  await serveHistory(page, [...WEEK_2], reports)
  await page.clock.setFixedTime(WEEK_3)
  await page.goto('/')

  await page.getByRole('button', { name: /^Start / }).click()
  await expect(page).toHaveURL('/live')
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Speed, 5 × 3′')
  await expect.poll(() => reports.at(-1)).toMatchObject({ score: 0, area: null, week: 3, sessionId: 'speed' })
})

test('Something hurts from Today: pain 6 makes the day easy bike or rest once Accepted', async ({ page }) => {
  const reports: Record<string, unknown>[] = []
  await serveHistory(page, [...WEEK_2], reports)
  await page.clock.setFixedTime(WEEK_3)
  await page.goto('/')

  await page.getByRole('button', { name: 'Something hurts' }).click()
  const form = page.getByRole('region', { name: 'Something hurts' })
  await pick(form, '6')
  await pick(form, 'Knee')
  await form.getByRole('button', { name: 'Tell the Coach' }).click()
  await expect.poll(() => reports.at(-1)).toMatchObject({ score: 6, area: 'knee', week: null, sessionId: null })

  const suggestion = page.getByRole('region', { name: 'Coach’s Suggestion' })
  await expect(suggestion).toContainText('Pain 6. Today becomes easy bike or rest. Not negotiable.')
  await expect(suggestion).toContainText('Pain 6 · Knee · every Session easy and low-impact')
  // Nothing changes until it's Accepted.
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Speed, 5 × 3′')
  await expectNoAxeViolations(page)

  await suggestion.getByRole('button', { name: 'Accept' }).click()
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Speed, easy bike 30′ or rest')
  // Nothing to run: Log after it instead.
  await expect(page.getByRole('button', { name: /^Start / })).toHaveCount(0)
  await expect(page.getByRole('link', { name: 'Log after' })).toBeVisible()
})

test('Gone records a 0 and starts; next time Start is one tap again', async ({ page }) => {
  const reports: Record<string, unknown>[] = [SHIN_2]
  await serveHistory(page, [...WEEK_2], reports)
  await page.clock.setFixedTime(WEEK_3)
  await page.goto('/')

  await page.getByRole('button', { name: /^Start / }).click()
  await page.getByRole('region', { name: 'Up next' }).getByRole('button', { name: 'Gone' }).click()
  await expect(page).toHaveURL('/live')
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Speed, 5 × 3′')
  await expect.poll(() => reports.at(-1)).toMatchObject({ score: 0, area: null, week: 3, sessionId: 'speed' })
})

test('Same repeats the standing report: pain 2 changes nothing, so it starts at once', async ({ page }) => {
  const reports: Record<string, unknown>[] = [SHIN_2]
  await serveHistory(page, [...WEEK_2], reports)
  await page.clock.setFixedTime(WEEK_3)
  await page.goto('/')

  await page.getByRole('button', { name: /^Start / }).click()
  await page.getByRole('region', { name: 'Up next' }).getByRole('button', { name: 'Same' }).click()
  await expect(page).toHaveURL('/live')
  await expect.poll(() => reports.at(-1)).toMatchObject({ score: 2, area: 'shin', week: 3, sessionId: 'speed' })
})

test('Log after asks too, and links the report to the Session', async ({ page }) => {
  const reports: Record<string, unknown>[] = []
  await serveHistory(page, [...WEEK_2], reports)
  await page.clock.setFixedTime(WEEK_3)
  await page.goto('/log/3/strength')

  await pick(page.getByRole('radiogroup', { name: 'Anything hurt?' }), 'Yes')
  await page.getByRole('button', { name: 'Save log' }).click()
  await expect(page.getByText('How bad and where, first. Or No.')).toBeVisible()
  await pick(page.getByRole('radiogroup', { name: 'How bad, 1–10' }), '2')
  await pick(page, 'Shin')
  await page.getByRole('button', { name: 'Save log' }).click()

  await expect(page).toHaveURL('/')
  await expect.poll(() => reports.at(-1)).toMatchObject({ score: 2, area: 'shin', week: 3, sessionId: 'strength' })
})
