import { expect, test, type Page } from '@playwright/test'
import { BEFORE_WEEK_1, expectNoAxeViolations } from './axe'
import { serveHistory } from './history'

/**
 * First launch: the Starting point, once, on a device with nothing stored,
 * against a served history so nothing reaches the shared database.
 */
test.use({ storageState: { cookies: [], origins: [] } })


const heading = (page: Page) => page.getByRole('heading', { level: 1 })

/** Week 1's Strength session, started early from its Week: the calibration's first load. */
async function firstSquat(page: Page) {
  await page.goto('/plan/week/1')
  await page.getByRole('region', { name: /^Strength/ }).getByRole('button', { name: 'Start session' }).click()
  await expect(page).toHaveURL('/live')
  return page.locator('header .stripe-num')
}

test('shows once; skipping both leaves runs RPE only and calibrations from the bar', async ({ page }) => {
  await serveHistory(page, [])
  await page.clock.setFixedTime(BEFORE_WEEK_1)
  await page.goto('/')

  await expect(heading(page)).toHaveText('Where are you starting from?')
  await expect(page.getByRole('navigation', { name: 'Main' })).toHaveCount(0)
  await expectNoAxeViolations(page)

  await page.getByRole('button', { name: 'Skip both' }).click()
  await expect(heading(page)).toHaveText('Week 1 starts Monday.')
  await page.reload()
  await expect(heading(page)).toHaveText('Week 1 starts Monday.')

  await page.goto('/plan/week/1')
  await expect(page.getByText('Runs go by RPE until there are Training paces')).toBeVisible()
  await expect(await firstSquat(page)).toHaveText('45')
})

test('estimates set estimated paces and the calibration start, editable in Settings until replaced', async ({
  page,
}) => {
  await serveHistory(page, [])
  await page.clock.setFixedTime(BEFORE_WEEK_1)
  await page.goto('/')

  await expect(heading(page)).toHaveText('Where are you starting from?')
  const time = page.getByRole('textbox', { name: '1 km split' })
  await time.fill('2')
  await page.getByRole('button', { name: 'Save and start' }).click()
  await expect(page.getByText('Minutes and seconds, like 5:30. That isn’t a time.')).toBeVisible()
  await time.fill('1500')
  await page.getByRole('button', { name: 'Save and start' }).click()
  await expect(page.getByText('A 1 km split between 2:30 and 10:00.')).toBeVisible()
  await time.fill('530')
  await expect(time).toHaveValue('5:30')
  await page.getByRole('textbox', { name: 'Back squat, lb' }).fill('225')
  await page.getByRole('button', { name: 'Save and start' }).click()
  await expect(heading(page)).toHaveText('Week 1 starts Monday.')

  // A 5:30 split reads as estimated Training paces: Race run pace 5:30, easy running 60–90 s/km slower.
  await page.goto('/plan/week/1')
  await expect(page.getByText('Estimated paces from your Starting point')).toBeVisible()
  await page.getByRole('region', { name: /^HYROX A/ }).getByRole('button', { name: 'Show the Prescription' }).click()
  await expect(page.getByText(/6:30–7:00\/km/).first()).toBeVisible()

  // 225 lb estimated: the squat's calibration ramps from 155 lb, the RDL with none from the bar.
  await expect(await firstSquat(page)).toHaveText('155')
  await page.evaluate(() => localStorage.removeItem('compromised:live'))

  // Settings shows the estimates, and takes a change.
  await page.goto('/')
  await page.getByRole('button', { name: 'Settings' }).click()
  const settings = page.getByRole('dialog', { name: 'Settings' })
  await expect(settings.getByRole('textbox', { name: '1 km split' })).toHaveValue('5:30')
  await expect(settings.getByRole('textbox', { name: 'Back squat, lb' })).toHaveValue('225')
  await expectNoAxeViolations(page)
  await settings.getByRole('textbox', { name: 'Back squat, lb' }).fill('245')
  await settings.getByRole('button', { name: 'Save estimates' }).click()
  await expect(settings.getByRole('status')).toHaveText('Saved.')
  await page.keyboard.press('Escape')
  // 70% of 245 is 171.5: down to 170.
  await expect(await firstSquat(page)).toHaveText('170')
})

test('a real calibration replaces the lift estimate, which Settings then shows read-only', async ({ page }) => {
  await serveHistory(page, [])
  await page.clock.setFixedTime(BEFORE_WEEK_1)
  await page.goto('/')
  await page.getByRole('textbox', { name: '1 km split' }).fill('530')
  await page.getByRole('textbox', { name: 'Back squat, lb' }).fill('225')
  await page.getByRole('button', { name: 'Save and start' }).click()
  await expect(heading(page)).toHaveText('Week 1 starts Monday.')

  // Two weeks on, the same device: the squat calibrated at 185 lb in Week 1.
  const later = await page.context().newPage()
  await serveHistory(later, [
    {
      week: 1,
      sessionId: 'strength',
      date: '2026-11-10',
      status: 'done',
      sets: [{ exercise: 0, set: 1, lift: 'back-squat', pounds: 185, reps: 5, rpe: 7 }],
    },
  ])
  await later.clock.setFixedTime(new Date('2026-11-25T12:00:00-05:00'))
  await later.goto('/plan/week/3')
  await expect(later.getByText('Estimated paces from your Starting point')).toBeVisible()

  await later.goto('/')
  await later.getByRole('button', { name: 'Settings' }).click()
  const settings = later.getByRole('dialog', { name: 'Settings' })
  // No test replaces the estimate yet: it stays editable.
  const split = settings.getByRole('textbox', { name: '1 km split' })
  await expect(split).toHaveValue('5:30')
  await expect(split).not.toHaveAttribute('readonly')
  const squat = settings.getByRole('textbox', { name: 'Back squat, lb' })
  await expect(squat).toHaveValue('185 lb')
  await expect(squat).toHaveAttribute('readonly')
  // The RDL has no calibration yet: its estimate is still there to edit.
  await expect(settings.getByRole('textbox', { name: 'Romanian deadlift, lb' })).not.toHaveAttribute('readonly')
})

test('a Done Compromised run test replaces the estimated split from its day on, which Settings then shows read-only', async ({
  page,
}) => {
  await serveHistory(page, [])
  await page.clock.setFixedTime(BEFORE_WEEK_1)
  await page.goto('/')
  await page.getByRole('textbox', { name: '1 km split' }).fill('530')
  await page.getByRole('button', { name: 'Save and start' }).click()
  await expect(heading(page)).toHaveText('Week 1 starts Monday.')

  // Week 2's test on Wednesday 18 November: four runs averaging 5:07/km.
  const later = await page.context().newPage()
  const run = (round: number, seconds: number) => ({ round, part: 'run', pounds: null, meters: 1000, reps: null, seconds })
  await serveHistory(later, [
    {
      week: 2,
      sessionId: 'compromised-run-test',
      date: '2026-11-18',
      status: 'done',
      rpe: 9,
      stations: [run(1, 298), run(2, 304), run(3, 309), run(4, 317)],
    },
  ])
  await later.clock.setFixedTime(new Date('2026-11-18T19:00:00-05:00'))
  await later.goto('/plan/week/3')
  await expect(later.getByText('Paces from your Compromised run test: Race run pace 5:07/km')).toBeVisible()

  await later.goto('/')
  await later.getByRole('button', { name: 'Settings' }).click()
  const settings = later.getByRole('dialog', { name: 'Settings' })
  await expect(settings.getByRole('textbox', { name: '1 km split' })).toHaveCount(0)
  const pace = settings.getByRole('textbox', { name: 'Race run pace, per km' })
  await expect(pace).toHaveValue('5:07')
  await expect(pace).toHaveAttribute('readonly')
})
