import { expect, test, type Locator, type Page } from '@playwright/test'
import { expectNoAxeViolations, WEEK_3 } from './axe'
import { caughtUp, serveHistory, weekDone } from './history'
import { startAsChosen } from './today'

/**
 * Pain reports and the pain rules. The server is stood in for, so nothing
 * here touches the shared database; Week 2 is done and Week 3's HYROX A and
 * B were done on Monday, so Wednesday of Week 3 has the Run, 3 × 8′ Up next.
 */
/**
 * Picks a toggle by its label. The radio's input sits visually hidden under
 * it; clicking the label lets Playwright scroll it clear of the tab bar.
 */
const pick = (scope: Page | Locator, name: string) =>
  scope.locator('label').filter({ hasText: new RegExp(`^${name}$`) }).click()

const WEEK_2 = [
  ...weekDone(2, ['hyrox-a', 'hyrox-b', 'compromised-run-test', 'strength'], '2026-11-19'),
  // Monday of Week 3: HYROX A and B, so the Run is what's left that isn't Strength.
  ...weekDone(3, ['hyrox-a', 'hyrox-b'], '2026-11-23'),
] as const

/** Shin 2 from Monday, outside any Session: still standing on Wednesday. */
const SHIN_2 = {
  id: 'seed-shin-2',
  date: '2026-11-23',
  score: 2,
  area: 'shin',
  week: null,
  sessionId: null,
  updatedAt: '2026-11-23T12:00:00.000Z',
}

test('pain 4 before the Run: the interval reps drop', async ({ page }) => {
  const reports: Record<string, unknown>[] = [SHIN_2]
  await serveHistory(page, caughtUp(1, [...WEEK_2]), reports)
  await page.clock.setFixedTime(WEEK_3)
  await page.goto('/')

  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Run, 3 × 8′')
  await page.getByRole('button', { name: /^Start / }).click()

  // Pain stands, so Start asks whether it still does, with Gone one tap away.
  const step = page.getByRole('region', { name: 'Up next' })
  await expect(step).toContainText('Shin 2 last time.')
  await expect(step.getByRole('button', { name: 'Gone' })).toBeFocused()
  await step.getByRole('button', { name: 'Changed' }).click()
  await pick(step, '4')
  await pick(step, 'Achilles / calf')
  await expect(step).toContainText('Pain 4 and rising. No jumps, no sled push, fewer reps, before it gets a vote.')
  await expectNoAxeViolations(page)
  await step.getByRole('button', { name: 'Start with that' }).click()
  await startAsChosen(page)

  // The Live session has it already: two reps for three.
  await expect(page).toHaveURL('/live')
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Run, 2 × 8′')
  const blocks = page.getByRole('list', { name: 'Blocks' }).getByRole('listitem')
  await expect(blocks).toHaveText([/^Warm-up/, /^Rep 1 of 2/, /^Jog/, /^Rep 2 of 2/, /^Cooldown/])

  await expect.poll(() => reports.at(-1)).toMatchObject({
    date: '2026-11-25',
    score: 4,
    area: 'achilles-calf',
    week: 3,
    sessionId: 'run',
  })
})

test('with nothing hurting on record, Start skips the pain step and starts the Session as written', async ({ page }) => {
  const reports: Record<string, unknown>[] = []
  await serveHistory(page, caughtUp(1, [...WEEK_2]), reports)
  await page.clock.setFixedTime(WEEK_3)
  await page.goto('/')

  await page.getByRole('button', { name: /^Start / }).click()
  await startAsChosen(page)
  await expect(page).toHaveURL('/live')
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Run, 3 × 8′')
  await expect.poll(() => reports.at(-1)).toMatchObject({ score: 0, area: null, week: 3, sessionId: 'run' })
})

test('Something hurts from Today: pain 6 makes the day easy bike or rest once Accepted', async ({ page }) => {
  const reports: Record<string, unknown>[] = []
  await serveHistory(page, caughtUp(1, [...WEEK_2]), reports)
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
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Run, 3 × 8′')
  await expectNoAxeViolations(page)

  await suggestion.getByRole('button', { name: 'Accept' }).click()
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Run, easy bike 30′ or rest')
  // Nothing to run: Log after it instead.
  await expect(page.getByRole('button', { name: /^Start / })).toHaveCount(0)
  await expect(page.getByRole('link', { name: 'Log after' })).toBeVisible()
})

test('Gone records a 0 and starts; next time Start skips the pain step', async ({ page }) => {
  const reports: Record<string, unknown>[] = [SHIN_2]
  await serveHistory(page, caughtUp(1, [...WEEK_2]), reports)
  await page.clock.setFixedTime(WEEK_3)
  await page.goto('/')

  await page.getByRole('button', { name: /^Start / }).click()
  await page.getByRole('region', { name: 'Up next' }).getByRole('button', { name: 'Gone' }).click()
  await startAsChosen(page)
  await expect(page).toHaveURL('/live')
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Run, 3 × 8′')
  await expect.poll(() => reports.at(-1)).toMatchObject({ score: 0, area: null, week: 3, sessionId: 'run' })
})

test('Same repeats the standing report: pain 2 changes nothing, so it starts at once', async ({ page }) => {
  const reports: Record<string, unknown>[] = [SHIN_2]
  await serveHistory(page, caughtUp(1, [...WEEK_2]), reports)
  await page.clock.setFixedTime(WEEK_3)
  await page.goto('/')

  await page.getByRole('button', { name: /^Start / }).click()
  await page.getByRole('region', { name: 'Up next' }).getByRole('button', { name: 'Same' }).click()
  await startAsChosen(page)
  await expect(page).toHaveURL('/live')
  await expect.poll(() => reports.at(-1)).toMatchObject({ score: 2, area: 'shin', week: 3, sessionId: 'run' })
})

test('Log after asks too, and links the report to the Session', async ({ page }) => {
  const reports: Record<string, unknown>[] = []
  await serveHistory(page, caughtUp(1, [...WEEK_2]), reports)
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

/** Achilles 4 from Monday: its pain Suggestion stands for the rest of Week 3. */
const ACHILLES_4 = { ...SHIN_2, id: 'seed-achilles-4', score: 4, area: 'achilles-calf' }

test('with the pain Suggestion open, the step asks it once, in its own words: two taps through the pain step', async ({
  page,
}) => {
  const reports: Record<string, unknown>[] = [ACHILLES_4]
  await serveHistory(page, caughtUp(1, [...WEEK_2]), reports)
  await page.clock.setFixedTime(WEEK_3)
  await page.goto('/')

  const line = 'Pain 4. No jumps, no sled push, fewer reps. Your tendons will thank you.'
  const suggestion = page.getByRole('region', { name: 'Coach’s Suggestion' }).filter({ hasText: line })
  await expect(suggestion).toBeVisible()
  await page.getByRole('button', { name: /^Start / }).click()

  // The step carries the Suggestion now: not asked twice.
  await expect(suggestion).toHaveCount(0)
  const step = page.getByRole('region', { name: 'Up next' })
  await step.getByRole('button', { name: 'Same' }).click()
  await expect(step).toContainText(line)
  await step.getByRole('button', { name: 'Start with that' }).click()
  await startAsChosen(page)

  await expect(page).toHaveURL('/live')
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Run, 2 × 8′')
})

test('with the pain Suggestion already accepted, Same starts the Session with it', async ({ page }) => {
  const reports: Record<string, unknown>[] = [ACHILLES_4]
  const suggestionDecisions: Record<string, unknown>[] = [
    { id: 'pain-seed-achilles-4', decision: 'accepted', date: '2026-11-25', updatedAt: '2026-11-25T11:00:00.000Z' },
  ]
  await serveHistory(page, caughtUp(1, [...WEEK_2]), reports, { suggestionDecisions })
  await page.clock.setFixedTime(WEEK_3)
  await page.goto('/')

  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Run, 2 × 8′')
  await page.getByRole('button', { name: /^Start / }).click()
  await page.getByRole('region', { name: 'Up next' }).getByRole('button', { name: 'Same' }).click()
  await startAsChosen(page)

  await expect(page).toHaveURL('/live')
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Run, 2 × 8′')
  // Same is a new report for this Session, and the decision carries over to it.
  await expect.poll(() => reports.at(-1)).toMatchObject({ score: 4, area: 'achilles-calf', week: 3, sessionId: 'run' })
  await expect
    .poll(() => suggestionDecisions.find((d) => d.id === `pain-${reports.at(-1)!.id}`))
    .toMatchObject({ decision: 'accepted' })
})

test('pain 4 Accepted: HYROX A rows instead of the sled push, and says why', async ({ page }) => {
  // Week 2 done; Week 3 untouched, so HYROX A is Up next on Wednesday.
  const week2 = weekDone(2, ['hyrox-a', 'hyrox-b', 'compromised-run-test', 'strength'], '2026-11-19')
  await serveHistory(page, caughtUp(1, week2), [ACHILLES_4])
  await page.clock.setFixedTime(WEEK_3)
  await page.goto('/')

  await expect(page.getByRole('heading', { level: 1 })).toHaveText(/^HYROX A, /)
  const suggestion = page.getByRole('region', { name: 'Coach’s Suggestion: pain' })
  await expect(suggestion).toContainText('row or SkiErg for burpee broad jumps and sled push, 30% fewer interval reps')
  await suggestion.getByRole('button', { name: 'Accept' }).click()
  await expect(suggestion).toContainText('Done. Ergs for the jumps and the sled, fewer reps.')

  await page.getByRole('button', { name: 'Show the Prescription' }).click()
  const sheet = page.getByRole('dialog', { name: /^HYROX A, / })
  await expect(sheet.getByRole('listitem').filter({ hasText: /^Row/ })).toContainText('Instead of sled push: pain says no impact.')
  await expect(sheet.getByRole('listitem').filter({ hasText: /^Sled push/ })).toHaveCount(0)
  await expectNoAxeViolations(page)
})
