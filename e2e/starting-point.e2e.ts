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
  await expect(page.getByText('Runs go by RPE until the baseline 5K test sets the Training paces')).toBeVisible()
  await expect(await firstSquat(page)).toHaveText('45')
})

test('estimates set estimated paces and the calibration start, editable in Settings until replaced', async ({
  page,
}) => {
  await serveHistory(page, [])
  await page.clock.setFixedTime(BEFORE_WEEK_1)
  await page.goto('/')

  await expect(heading(page)).toHaveText('Where are you starting from?')
  const time = page.getByRole('textbox', { name: '5 km time' })
  await time.fill('2')
  await page.getByRole('button', { name: 'Save and start' }).click()
  await expect(page.getByText('Minutes and seconds, like 21:00. That isn’t a time.')).toBeVisible()
  await time.fill('2100')
  await expect(time).toHaveValue('21:00')
  await page.getByRole('textbox', { name: 'Back squat, lb' }).fill('225')
  await page.getByRole('button', { name: 'Save and start' }).click()
  await expect(heading(page)).toHaveText('Week 1 starts Monday.')

  // A 21:00 estimate reads as estimated Training paces: easy running at 5:22–5:55/km outdoors in October.
  await page.goto('/plan/week/1')
  await expect(page.getByText('Estimated paces from your 21:00 5K estimate, until the first 5K test')).toBeVisible()
  await page.getByRole('button', { name: 'Show the Prescription' }).first().click()
  await expect(page.getByText(/5:22–5:55\/km/).first()).toBeVisible()

  // 225 lb estimated: the squat's calibration ramps from 155 lb, the RDL with none from the bar.
  await expect(await firstSquat(page)).toHaveText('155')
  await page.evaluate(() => localStorage.removeItem('compromised:live'))

  // Settings shows the estimates, and takes a change.
  await page.goto('/')
  await page.getByRole('button', { name: 'Settings' }).click()
  const settings = page.getByRole('dialog', { name: 'Settings' })
  await expect(settings.getByRole('textbox', { name: '5 km time' })).toHaveValue('21:00')
  await expect(settings.getByRole('textbox', { name: 'Back squat, lb' })).toHaveValue('225')
  await expectNoAxeViolations(page)
  await settings.getByRole('textbox', { name: 'Back squat, lb' }).fill('245')
  await settings.getByRole('button', { name: 'Save estimates' }).click()
  await expect(settings.getByRole('status')).toHaveText('Saved.')
  await page.keyboard.press('Escape')
  // 70% of 245 is 171.5: down to 170.
  await expect(await firstSquat(page)).toHaveText('170')
})

test('a real 5K test and calibration replace the estimates, which Settings then shows read-only', async ({
  page,
}) => {
  await serveHistory(page, [])
  await page.clock.setFixedTime(BEFORE_WEEK_1)
  await page.goto('/')
  await page.getByRole('textbox', { name: '5 km time' }).fill('2100')
  await page.getByRole('textbox', { name: 'Back squat, lb' }).fill('225')
  await page.getByRole('button', { name: 'Save and start' }).click()
  await expect(heading(page)).toHaveText('Week 1 starts Monday.')

  // Three weeks on, the same device: a 23:00 test in Week 2 and the squat calibrated at 185 lb.
  const later = await page.context().newPage()
  await serveHistory(later, [
    {
      week: 1,
      sessionId: 'strength',
      date: '2026-10-27',
      status: 'done',
      sets: [{ exercise: 0, set: 1, lift: 'back-squat', pounds: 185, reps: 5, rpe: 7 }],
    },
    { week: 2, sessionId: '5k-test', date: '2026-11-04', status: 'done', resultSeconds: 23 * 60, environment: 'indoor' },
  ])
  await later.clock.setFixedTime(new Date('2026-11-11T12:00:00-05:00'))
  await later.goto('/plan/week/3')
  await expect(later.getByText(/^Paces from the 23:00 5K test/)).toBeVisible()

  await later.goto('/')
  await later.getByRole('button', { name: 'Settings' }).click()
  const settings = later.getByRole('dialog', { name: 'Settings' })
  const fiveK = settings.getByRole('textbox', { name: '5 km time' })
  await expect(fiveK).toHaveValue('23:00')
  await expect(fiveK).toHaveAttribute('readonly')
  const squat = settings.getByRole('textbox', { name: 'Back squat, lb' })
  await expect(squat).toHaveValue('185 lb')
  await expect(squat).toHaveAttribute('readonly')
  // The RDL has no calibration yet: its estimate is still there to edit.
  await expect(settings.getByRole('textbox', { name: 'Romanian deadlift, lb' })).not.toHaveAttribute('readonly')
})
