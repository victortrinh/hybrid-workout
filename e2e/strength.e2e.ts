import { expect, test, type Page } from '@playwright/test'
import { expectNoAxeViolations, WEEK_3 } from './axe'
import { serveHistory, weekDone, type SeedLog } from './history'
import { aMinuteBefore, doToday } from './today'

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

/** The set the screen leads with: Log set in the bar under the thumb, the only primary. */
const currentLog = (page: Page) => page.getByRole('button', { name: /^Log set \d+ · / })

/** axe waits on timers of its own, so the clock runs while it scans. */
async function scan(page: Page) {
  await page.clock.resume()
  await expectNoAxeViolations(page)
}

test('a full Strength session: a load change, RPEs, a missed rep, then the Coach’s Suggestion', async ({ page }) => {
  const sent = await serveHistory(page, HISTORY)
  await page.clock.install({ time: aMinuteBefore(WEEK_3) })
  await page.goto('/')
  await doToday(page, page.getByRole('list').filter({ hasText: 'Threshold' }).getByRole('button', { name: /^Strength/ }))
  await page.clock.pauseAt(new Date(WEEK_3.getTime() + 1000))

  // Today shows the loads in pounds from the Working weights.
  const bucket = page.getByRole('list').filter({ hasText: 'Threshold' })
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Strength, squat 3 × 5')
  await expect(page.getByRole('heading', { level: 1 }).locator('xpath=following-sibling::p[1]')).toHaveText(
    'Squat 3 × 5 at 185 lb, RDL 3 × 6 at 135 lb · RPE 7',
  )
  await page.getByRole('button', { name: /^Start / }).click()

  await expect(page).toHaveURL('/live')
  const band = page.locator('header')
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Strength, squat 3 × 5')
  await expect(band.locator('p').first()).toHaveText('Back squat · Set 1 of 3')
  await expect(band.locator('.stripe-num')).toHaveText('185')
  await expect(band.getByText('lb × 5')).toBeVisible()
  await expect(band.locator('[aria-live]')).toHaveText('Back squat first. RPE 7: three left in the tank.')
  await expect(page.getByRole('img', { name: '0 of 15 sets logged' })).toBeVisible()
  // The Substitutions from the athlete's gym: no calf machines.
  await expect(page.getByRole('heading', { name: 'Single-leg calf raise' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Loaded seated calf raise' })).toBeVisible()

  // The bar leads with the current set and its load; the rows wait their turn.
  const squat = page.getByRole('region', { name: 'Back squat' })
  const set = (n: number) => squat.getByRole('listitem', { name: `Back squat, set ${n}` })
  await expect(currentLog(page)).toHaveAccessibleName('Log set 1 · 185 lb, Back squat')
  await expect(page.locator('li[aria-current="step"]')).toHaveAccessibleName('Back squat, set 1')

  // Set 1, then the rest timer: in place, counting down.
  await currentLog(page).click()
  await expect(band.locator('[aria-live]')).toHaveText('Set 1 logged at RPE 7. Tap the RPE if that was a lie.')
  const rest = page.getByRole('timer', { name: 'Rest left' })
  await expect(rest).toHaveText('2:00')
  const restBefore = await rest.elementHandle()
  await page.clock.runFor('00:30')
  await expect(rest).toHaveText('1:30')
  expect(await rest.evaluate((el, before) => el === before, restBefore)).toBe(true)

  // RPE per set, defaulting to the target: shown in the rest bar, changed from there in two taps.
  const rpe1 = page.getByRole('radiogroup', { name: 'RPE for Back squat, set 1' })
  await expect(rpe1.getByRole('radio', { name: '7' })).toBeChecked()
  await page.getByRole('button', { name: 'Set 1 at RPE 7. Change' }).click()
  // Picking closes the toggles, so click the label rather than check (which reads the radio back).
  await page
    .getByRole('radiogroup', { name: 'RPE for Back squat, set 1, from the rest bar' })
    .locator('label')
    .filter({ hasText: /^8$/ })
    .click()
  await expect(rpe1.getByRole('radio', { name: '8' })).toBeChecked()
  await expect(page.getByRole('button', { name: 'Set 1 at RPE 8. Change' })).toBeVisible()
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
  // Overall RPE starts on the hardest set logged.
  await expect(page.getByRole('radio', { name: '8', exact: true })).toBeChecked()
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

  // Every RDL rep at RPE 7: +5 lb, in the one lift Suggestion, and only Accept moves it.
  const lifts = page.getByRole('region', { name: 'Coach’s Suggestion: lifts' })
  await expect(lifts).toContainText('Lifts: +5 lb on all four. Every rep, nothing past RPE 7.')
  await expect(lifts).toContainText('Week 3: RDL, ')
  await lifts.getByRole('button', { name: 'One by one' }).click()
  await lifts.getByRole('button', { name: 'Accept RDL 135 → 140 lb' }).click()
  await expect(lifts.getByRole('listitem').filter({ hasText: 'RDL' })).toContainText('RDL 135 → 140 lb · accepted')
  await expect(lifts.getByRole('button', { name: 'Accept all' })).toBeVisible()
})

test('as prescribed, a Strength session is one tap per set plus three: Start, Finish, Save', async ({ page }) => {
  const sent = await serveHistory(page, HISTORY)
  await page.clock.install({ time: aMinuteBefore(WEEK_3) })
  await page.goto('/')
  await doToday(page, page.getByRole('list').filter({ hasText: 'Threshold' }).getByRole('button', { name: /^Strength/ }))
  await page.clock.pauseAt(new Date(WEEK_3.getTime() + 1000))

  let taps = 0
  const tap = async (button: ReturnType<Page['getByRole']>) => {
    taps += 1
    await button.click()
  }
  await tap(page.getByRole('button', { name: /^Start / }))
  // Under the thumb every time: the bar's Log set, during the rest too.
  for (let i = 0; i < 15; i++) await tap(currentLog(page))
  await tap(page.getByRole('button', { name: 'Finish session' }))
  await tap(page.getByRole('button', { name: 'Save log' }))

  await expect(page).toHaveURL('/')
  expect(taps).toBe(15 + 3)
  await expect.poll(() => sent.at(-1)).toMatchObject({ sessionId: 'strength', status: 'done', rpe: 7 })
})

test('Week 1 calibrates: ramp to RPE 7, and that load is the Working weight', async ({ page }) => {
  const wednesday = new Date('2026-10-21T12:00:00-04:00')
  const sent = await serveHistory(page, [])
  await page.clock.install({ time: aMinuteBefore(wednesday) })
  await page.goto('/')
  await doToday(page, page.getByRole('list').filter({ hasText: 'Threshold' }).getByRole('button', { name: /^Strength/ }))
  await page.clock.pauseAt(new Date(wednesday.getTime() + 1000))

  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Strength, find Working weights')
  await page.getByRole('button', { name: /^Start / }).click()

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
  await strength.getByRole('button', { name: 'Show the Prescription' }).click()
  await expect(strength.getByRole('listitem').filter({ hasText: 'Back squat' })).toHaveText(/3\s×\s5\s·\s185\slb\s·\sRPE\s7/)
  await expect(strength.getByRole('listitem').filter({ hasText: 'Romanian deadlift' })).toHaveText(/3\s×\s6\s·\sRPE\s7/)
})

test('the Equipment profile swaps Exercises for what the gym has', async ({ page }) => {
  await serveHistory(page, [])
  await page.clock.install({ time: WEEK_3 })
  await page.goto('/plan/week/3')
  const strength = page.getByRole('region', { name: 'Strength, squat 3 × 5' })
  await strength.getByRole('button', { name: 'Show the Prescription' }).click()
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
  await strength.getByRole('button', { name: 'Show the Prescription' }).click()
  await expect(strength).toContainText('Standing calf raise')
  await expect(strength).toContainText('Instead, if no standing calf machine: Single-leg calf raise')
  await expect(strength).toContainText('Loaded seated calf raise')
})

/** Week 2's squat was every rep at RPE 7: the Coach suggests 190 lb, still open. */
const EASY_SQUAT: SeedLog[] = HISTORY.map((log) =>
  log.week === 2 && log.sessionId === 'strength'
    ? {
        ...log,
        sets: sets([
          [0, 'back-squat', 185, 5, 7, 3],
          [1, 'romanian-deadlift', 135, 6, 8, 3],
        ]),
      }
    : log,
)

test('a pending Working weight is asked before set 1: Accept moves every squat set, and Today shows it decided', async ({
  page,
}) => {
  const decisions: Record<string, unknown>[] = []
  await serveHistory(page, EASY_SQUAT, [], { suggestionDecisions: decisions })
  await page.clock.install({ time: aMinuteBefore(WEEK_3) })
  await page.goto('/')
  await doToday(page, page.getByRole('list').filter({ hasText: 'Threshold' }).getByRole('button', { name: /^Strength/ }))
  await page.clock.pauseAt(new Date(WEEK_3.getTime() + 1000))

  await page.getByRole('button', { name: /^Start / }).click()
  await expect(page).toHaveURL('/live')

  // Only the squat: the RDL held at RPE 8, so nothing to ask.
  const prompt = page.getByRole('region', { name: /^Working weight, / })
  await expect(prompt).toHaveCount(1)
  await expect(prompt).toHaveAccessibleName('Working weight, Back squat')
  await expect(prompt).toContainText('Back squat: 185 → 190 lb?')
  await expect(prompt).toContainText('Week 2: 3 × 5 at 185 lb, top RPE 7 · +5 lb')
  await expect(prompt.getByRole('button', { name: 'Keep 185 lb' })).toBeVisible()
  await scan(page)

  await prompt.getByRole('button', { name: 'Accept' }).click()
  await expect(prompt).toHaveCount(0)
  const squat = page.getByRole('region', { name: 'Back squat' })
  for (const n of [1, 2, 3]) {
    await expect(squat.getByRole('listitem', { name: `Back squat, set ${n}` }).getByRole('textbox')).toHaveValue('190')
  }
  await expect(page.locator('header .stripe-num')).toHaveText('190')
  await expect(currentLog(page)).toHaveAccessibleName('Log set 1 · 190 lb, Back squat')
  await expect.poll(() => decisions).toEqual([expect.objectContaining({ id: 'ww-back-squat-w2', decision: 'accepted' })])

  // The same decision as an Accept on Today.
  await page.goto('/')
  const suggestion = page.getByRole('region', { name: 'Coach’s Suggestion' }).filter({ hasText: 'Squat' })
  await expect(suggestion).toContainText('Squat is 190 lb now. Same face, more plates.')
  await expect(suggestion.getByRole('button', { name: 'Undo' })).toBeVisible()
})

test('Keep leaves the loads where they are', async ({ page }) => {
  const decisions: Record<string, unknown>[] = []
  await serveHistory(page, EASY_SQUAT, [], { suggestionDecisions: decisions })
  await page.clock.install({ time: aMinuteBefore(WEEK_3) })
  await page.goto('/')
  await doToday(page, page.getByRole('list').filter({ hasText: 'Threshold' }).getByRole('button', { name: /^Strength/ }))
  await page.clock.pauseAt(new Date(WEEK_3.getTime() + 1000))
  await page.getByRole('button', { name: /^Start / }).click()

  await page.getByRole('button', { name: 'Keep 185 lb' }).click()
  await expect(page.getByRole('region', { name: /^Working weight, / })).toHaveCount(0)
  await expect(currentLog(page)).toHaveAccessibleName('Log set 1 · 185 lb, Back squat')
  await expect.poll(() => decisions).toEqual([expect.objectContaining({ id: 'ww-back-squat-w2', decision: 'kept' })])
})

test('tapping a load selects it, so typing 225 replaces it in one go', async ({ page }) => {
  await serveHistory(page, HISTORY)
  await page.clock.install({ time: aMinuteBefore(WEEK_3) })
  await page.goto('/')
  await doToday(page, page.getByRole('list').filter({ hasText: 'Threshold' }).getByRole('button', { name: /^Strength/ }))
  await page.clock.pauseAt(new Date(WEEK_3.getTime() + 1000))
  await page.getByRole('button', { name: /^Start / }).click()

  const squat = page.getByRole('region', { name: 'Back squat' })
  const load = (n: number) => squat.getByRole('listitem', { name: `Back squat, set ${n}` }).getByRole('textbox')
  await expect(load(1)).toHaveAttribute('inputmode', 'numeric')
  const box = await load(1).boundingBox()
  expect(box!.height).toBeGreaterThanOrEqual(44)

  await load(1).click()
  await page.clock.runFor(50)
  await page.keyboard.type('225')
  await page.keyboard.press('Enter')
  await expect(load(1)).toHaveValue('225')
  await expect(load(3)).toHaveValue('225')
  await expect(currentLog(page)).toHaveAccessibleName('Log set 1 · 225 lb, Back squat')
  // − and + still step 5 lb.
  await squat.getByRole('listitem', { name: 'Back squat, set 1' }).getByRole('button', { name: 'Heavier' }).click()
  await expect(load(1)).toHaveValue('230')
})
