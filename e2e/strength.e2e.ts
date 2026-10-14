import { expect, test, type Page } from '@playwright/test'
import { expectNoAxeViolations, WEEK_3 } from './axe'
import { serveHistory, weekDone, type SeedLog } from './history'

/**
 * Live Strength sessions under a controlled clock, against a served history:
 * nothing is written to the shared database; the test reads what the page synced.
 */

type Lift = [exercise: number, lift: string | null, pounds: number | null, reps: number, rpe: number, sets: number]

const sets = (lifts: Lift[]): SeedLog['sets'] =>
  lifts.flatMap(([exercise, lift, pounds, reps, rpe, count]) =>
    Array.from({ length: count }, (_, i) => ({ exercise, set: i + 1, lift, pounds, reps, rpe })),
  )

/**
 * Week 1 calibrated every lift; Week 2 lifted them all at RPE 8, which moves
 * nothing. The 5K test, Threshold and HYROX are done too: no Suggestions waiting.
 */
const HISTORY: SeedLog[] = [
  ...weekDone(1, ['speed', 'threshold', 'hyrox'], '2026-10-20'),
  {
    week: 1,
    sessionId: 'strength',
    date: '2026-10-21',
    status: 'done',
    sets: sets([
      [0, 'back-squat', 185, 5, 7, 1],
      [1, 'romanian-deadlift', 135, 6, 7, 1],
      [2, 'bulgarian-split-squat', 30, 6, 7, 1],
      [3, 'single-leg-calf-raise', 35, 8, 7, 1],
      [4, 'seated-calf-raise', 65, 10, 7, 1],
    ]),
  },
  { week: 2, sessionId: '5k-test', date: '2026-10-27', status: 'done', resultSeconds: 23 * 60, environment: 'indoor' },
  ...weekDone(2, ['threshold', 'hyrox'], '2026-10-28'),
  {
    week: 2,
    sessionId: 'strength',
    date: '2026-10-29',
    status: 'done',
    sets: sets([
      [0, 'back-squat', 185, 5, 8, 3],
      [1, 'romanian-deadlift', 135, 6, 8, 3],
    ]),
  },
]

/** The set the screen leads with: the only one whose Log set is primary. */
const currentLog = (page: Page) => page.locator('li[aria-current="step"]').getByRole('button', { name: /^Log / })

/** axe waits on timers of its own, so the clock runs while it scans. */
async function scan(page: Page) {
  await page.clock.resume()
  await expectNoAxeViolations(page)
}

test('a full Strength session: a load change, RPEs, a missed rep, then the Coach’s Suggestion', async ({ page }) => {
  const sent = await serveHistory(page, HISTORY)
  await page.clock.install({ time: WEEK_3 })
  await page.goto('/')
  await page.clock.pauseAt(new Date(WEEK_3.getTime() + 1000))

  // Today shows the loads in pounds from the Working weights.
  const bucket = page.getByRole('list').filter({ hasText: 'Threshold' })
  await bucket.getByRole('button', { name: /^Strength/ }).click()
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Strength, squat 3 × 5')
  await expect(page.getByRole('heading', { level: 1 }).locator('xpath=following-sibling::p[1]')).toHaveText(
    'Squat 3 × 5 at 185 lb, RDL 3 × 6 at 135 lb · RPE 7',
  )
  await page.getByRole('button', { name: 'Start session' }).click()

  await expect(page).toHaveURL('/live')
  const band = page.locator('header')
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Strength, squat 3 × 5')
  await expect(band.locator('p').first()).toHaveText('Back squat · Set 1 of 3')
  await expect(band.locator('.stripe-num')).toHaveText('185')
  await expect(band.getByText('lb × 5')).toBeVisible()
  await expect(band.locator('[aria-live]')).toHaveText('Back squat first. RPE 7 means three left in the tank.')
  await expect(page.getByRole('img', { name: '0 of 15 sets logged' })).toBeVisible()
  // The Substitutions from the athlete's gym: no calf machines.
  await expect(page.getByRole('heading', { name: 'Single-leg calf raise' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Loaded seated calf raise' })).toBeVisible()

  // Only the current set's Log set is primary; the other sets wait their turn.
  const squat = page.getByRole('region', { name: 'Back squat' })
  const set = (n: number) => squat.getByRole('listitem', { name: `Back squat, set ${n}` })
  await expect(currentLog(page)).toHaveAccessibleName('Log Back squat, set 1')

  // Set 1, then the rest timer: in place, counting down.
  await currentLog(page).click()
  await expect(band.locator('[aria-live]')).toHaveText('Set 1 logged at RPE 7. Change it below if that was a lie.')
  const rest = page.getByRole('timer', { name: 'Rest left' })
  await expect(rest).toHaveText('2:00')
  const restBefore = await rest.elementHandle()
  await page.clock.runFor('00:30')
  await expect(rest).toHaveText('1:30')
  expect(await rest.evaluate((el, before) => el === before, restBefore)).toBe(true)

  // RPE per set, defaulting to the target.
  const rpe1 = page.getByRole('radiogroup', { name: 'RPE for Back squat, set 1' })
  await expect(rpe1.getByRole('radio', { name: '7' })).toBeChecked()
  await rpe1.getByRole('radio', { name: '8' }).check({ force: true })
  await expect(band.locator('[aria-live]')).toHaveText('Two left. Fine. Do not get greedy.')

  // Heavier on set 2: set 3 follows, the logged set doesn't.
  await set(2).getByRole('button', { name: /Heavier/ }).click()
  await expect(set(2).getByRole('textbox')).toHaveValue('190')
  await expect(set(3).getByRole('textbox')).toHaveValue('190')
  await expect(set(1).getByRole('textbox')).toHaveValue('185')
  await expect(band.locator('.stripe-num')).toHaveText('190')

  // The rest runs out on its own.
  await page.clock.runFor('01:30')
  await expect(rest).toHaveCount(0)
  await expect(band.locator('[aria-live]')).toHaveText('Rest over. Under the bar.')

  await currentLog(page).click()
  await currentLog(page).click()
  await expect(band.locator('p').first()).toHaveText('Romanian deadlift · Set 1 of 3')

  // RDL: every set at RPE 7, but the last one short a rep.
  for (let i = 0; i < 3; i++) await currentLog(page).click()
  const rdl3 = page.getByRole('listitem', { name: 'Romanian deadlift, set 3' })
  await rdl3.getByRole('button', { name: /^Reps for Romanian deadlift, set 3/ }).click()
  await rdl3.getByRole('textbox', { name: 'Reps done' }).fill('5')
  await rdl3.getByRole('button', { name: 'Save' }).click()
  await expect(rdl3.getByRole('button', { name: /^Reps for/ })).toHaveText('5 reps · Change')
  await rdl3.getByRole('button', { name: /^Reps for/ }).click()
  await rdl3.getByRole('textbox', { name: 'Reps done' }).fill('6')
  await rdl3.getByRole('button', { name: 'Save' }).click()

  await expect(page.getByRole('img', { name: '6 of 15 sets logged' })).toBeVisible()
  await scan(page)

  // Away to Today and back, a reload between: every set is still there.
  await page.goto('/')
  await page.getByRole('link', { name: 'Resume Strength, squat 3 × 5' }).click()
  await page.reload()
  await expect(page.getByRole('img', { name: '6 of 15 sets logged' })).toBeVisible()

  // The rest of the sets, as prefilled.
  for (let i = 0; i < 9; i++) await currentLog(page).click()
  await expect(band.locator('p').first()).toHaveText('All sets logged.')
  await expect(rest).toHaveCount(0)

  await page.getByRole('button', { name: 'Finish session' }).click()
  await expect(page.getByText('Session over')).toBeVisible()
  await page.getByRole('radio', { name: '8', exact: true }).check({ force: true })
  await scan(page)
  await page.getByRole('button', { name: 'Save log' }).click()

  await expect(page).toHaveURL('/')
  await expect(bucket.getByRole('listitem').nth(1)).toHaveText(/^Strength.*Done, Wed$/)
  await expect.poll(() => sent.at(-1)).toMatchObject({
    week: 3,
    sessionId: 'strength',
    date: '2026-11-04',
    status: 'done',
    rpe: 8,
  })
  const saved = sent.at(-1)!.sets as { lift: string; pounds: number; reps: number; rpe: number }[]
  expect(saved).toHaveLength(15)
  expect(saved.slice(0, 6)).toEqual([
    { exercise: 0, set: 1, lift: 'back-squat', pounds: 185, reps: 5, rpe: 8 },
    { exercise: 0, set: 2, lift: 'back-squat', pounds: 190, reps: 5, rpe: 7 },
    { exercise: 0, set: 3, lift: 'back-squat', pounds: 190, reps: 5, rpe: 7 },
    { exercise: 1, set: 1, lift: 'romanian-deadlift', pounds: 135, reps: 6, rpe: 7 },
    { exercise: 1, set: 2, lift: 'romanian-deadlift', pounds: 135, reps: 6, rpe: 7 },
    { exercise: 1, set: 3, lift: 'romanian-deadlift', pounds: 135, reps: 6, rpe: 7 },
  ])
  expect(saved.at(-1)).toEqual({ exercise: 5, set: 2, lift: null, pounds: null, reps: 6, rpe: 7 })

  // Every RDL rep at RPE 7: the Coach suggests +5 lb, and only Accept moves it.
  const suggestion = page.getByRole('region', { name: 'Coach’s Suggestion' }).filter({ hasText: 'RDL' })
  await expect(suggestion).toContainText('RDL: every rep, nothing harder than RPE 7. 135 lb was a warm-up. 140 lb next time.')
  await expect(suggestion).toContainText('Week 3: 3 × 6 at 135 lb, top RPE 7 · +5 lb')
  await suggestion.getByRole('button', { name: 'Accept' }).click()
  await expect(suggestion).toContainText('RDL is 140 lb now. Same face, more plates.')
})

test('Week 1 calibrates: ramp to RPE 7, and that load is the Working weight', async ({ page }) => {
  const wednesday = new Date('2026-10-21T12:00:00-04:00')
  const sent = await serveHistory(page, [])
  await page.clock.install({ time: wednesday })
  await page.goto('/')
  await page.clock.pauseAt(new Date(wednesday.getTime() + 1000))

  const bucket = page.getByRole('list').filter({ hasText: 'Threshold' })
  await bucket.getByRole('button', { name: /^Strength/ }).click()
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Strength, find Working weights')
  await page.getByRole('button', { name: 'Start session' }).click()

  const band = page.locator('header')
  await expect(band.locator('.stripe-num')).toHaveText('45')
  await expect(band.locator('[aria-live]')).toHaveText(
    'Calibration. Ramp up. Stop when a set feels like RPE 7: three left in the tank.',
  )
  const squat = page.getByRole('region', { name: 'Back squat' })
  await expect(squat).toContainText('3 × 5 · ramp to RPE 7')

  // Typed loads for the ramp, a fourth set, and the last one too heavy.
  const load = (n: number) => squat.getByRole('listitem', { name: `Back squat, set ${n}` }).getByRole('textbox')
  const rpe = (n: number) => squat.getByRole('radiogroup', { name: `RPE for Back squat, set ${n}` })
  await load(1).fill('135')
  await load(1).press('Enter')
  await currentLog(page).click()
  await rpe(1).getByRole('radio', { name: '5' }).check({ force: true })
  await load(2).fill('165')
  await load(2).press('Enter')
  await currentLog(page).click()
  await rpe(2).getByRole('radio', { name: '6' }).check({ force: true })
  await load(3).fill('185')
  await load(3).press('Enter')
  await currentLog(page).click()
  await squat.getByRole('button', { name: 'Another ramp set' }).click()
  await load(4).fill('200')
  await load(4).press('Enter')
  await currentLog(page).click()
  await rpe(4).getByRole('radio', { name: '9' }).check({ force: true })

  await page.getByRole('button', { name: 'End' }).click()
  await expect(page.getByText('Ended early')).toBeVisible()
  await page.getByRole('radio', { name: '6', exact: true }).check({ force: true })
  await page.getByRole('button', { name: 'Save log' }).click()
  await expect.poll(() => sent.at(-1)).toMatchObject({ week: 1, sessionId: 'strength', status: 'partial' })

  // Week 2 prescribes the heaviest set at RPE 7: 185 lb. The RDL, never ramped, waits for its first session.
  await page.goto('/plan/week/2')
  const strength = page.getByRole('region', { name: 'Strength, squat 3 × 5' })
  await expect(strength.getByRole('listitem').filter({ hasText: 'Back squat' })).toHaveText(/3\s×\s5\s·\s185\slb\s·\sRPE\s7/)
  await expect(strength.getByRole('listitem').filter({ hasText: 'Romanian deadlift' })).toHaveText(/3\s×\s6\s·\sRPE\s7/)
})

test('the Equipment profile swaps Exercises for what the gym has', async ({ page }) => {
  await serveHistory(page, [])
  await page.clock.install({ time: WEEK_3 })
  await page.goto('/plan/week/3')
  const strength = page.getByRole('region', { name: 'Strength, squat 3 × 5' })
  await expect(strength).toContainText('Single-leg calf raise')
  await expect(strength).not.toContainText('Standing calf raise')

  await page.goto('/')
  await page.getByRole('button', { name: 'Settings' }).click()
  const settings = page.getByRole('dialog', { name: 'Settings' })
  const machine = settings.getByRole('checkbox', { name: 'Standing calf machine' })
  await expect(machine).not.toBeChecked()
  await expect(settings.getByRole('checkbox', { name: 'Floor space for jumps' })).toBeChecked()
  await machine.check({ force: true })
  await expect(machine).toBeChecked()
  await expectNoAxeViolations(page)
  await page.keyboard.press('Escape')

  await page.goto('/plan/week/3')
  await expect(strength).toContainText('Standing calf raise')
  await expect(strength).toContainText('Instead, if no standing calf machine: Single-leg calf raise')
  await expect(strength).toContainText('Loaded seated calf raise')
})
