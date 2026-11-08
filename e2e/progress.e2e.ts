import { expect, test } from '@playwright/test'
import { expectNoAxeViolations, WEEK_3 } from './axe'
import { BASELINE_DECISIONS, BASELINE_HISTORY } from '../src/mock/scenarios/seed'
import { serveHistory, type SeedLog } from './history'


/**
 * Week 1 mostly done, the baseline Compromised run test in Week 2 (the
 * scenario `after-baseline` starts from the same history), then Week 2's
 * HYROX B Skipped and Week 3's HYROX A done: Wednesday of Week 3.
 */
const HISTORY: SeedLog[] = [
  ...BASELINE_HISTORY,
  { week: 2, sessionId: 'hyrox-b', date: '2026-11-21', status: 'skipped' },
  { week: 3, sessionId: 'hyrox-a', date: '2026-11-23', status: 'done', rpe: 7 },
]

/** 14 mornings to Wednesday of Week 3: one missing, two short, last night 5 h 41 with HRV 38. */
const NIGHTS = [
  ['2026-11-12', 450, 54],
  ['2026-11-13', 414, 51],
  ['2026-11-14', 468, 57],
  ['2026-11-15', 426, 53],
  ['2026-11-16', 350, 47],
  ['2026-11-17', 450, 55],
  ['2026-11-19', 432, 52],
  ['2026-11-20', 408, 50],
  ['2026-11-21', 456, 56],
  ['2026-11-22', 420, 53],
  ['2026-11-23', 390, 49],
  ['2026-11-24', 438, 52],
  ['2026-11-25', 341, 38],
].map(([date, sleepMinutes, hrvMs]) => ({
  date,
  sleepMinutes,
  hrvMs,
  restingHeartRate: 50,
  source: 'Ultrahuman',
  receivedAt: `${date}T11:00:00.000Z`,
}))

test.beforeEach(async ({ page }, testInfo) => {
  if (testInfo.title.startsWith('before any data')) return
  // Training paces from the Starting point's estimate, kept on this device.
  await page.addInitScript(() =>
    localStorage.setItem(
      'compromised:starting-point',
      JSON.stringify({ point: { fiveKSeconds: 23 * 60, weights: {}, updatedAt: '2026-11-05T12:00:00.000Z' }, pending: false }),
    ),
  )
  await serveHistory(page, HISTORY, [], { suggestionDecisions: BASELINE_DECISIONS, recoveryNights: NIGHTS })
  await page.clock.setFixedTime(WEEK_3)
})

for (const colorScheme of ['light', 'dark'] as const) {
  test(`every Progress panel renders from the history, ${colorScheme}`, async ({ page }) => {
    await page.emulateMedia({ colorScheme })
    await page.goto('/progress')
    const main = page.getByRole('main')

    for (const name of [
      '5K vs. sub-22',
      'Weekly completion',
      'Training load',
      'Training paces',
      'Recovery',
      'Working weights',
      'HYROX stations',
    ]) {
      await expect(main.getByRole('heading', { level: 2, name })).toBeVisible()
    }

    // Weekly completion: Foundation so far, one row per Week, linking to it.
    const completion = main.getByRole('region', { name: 'Weekly completion' })
    await expect(completion.getByRole('link')).toHaveCount(3)
    await expect(completion.getByRole('link', { name: /^Week 1: 4 of 4 done/ })).toBeVisible()
    await expect(completion.getByRole('link', { name: /^Week 2: 2 of 4 done, 1 missed, Test/ })).toBeVisible()
    await expect(completion.getByRole('link', { name: /^Week 3, this Week: 1 of 4 done/ })).toHaveAttribute(
      'aria-current',
      'date',
    )

    // Training load: RPE × minutes. Week 1: 7×50 + 6×45 + 6×45 + 7×45 = 1205.
    await expect(page.getByRole('img', { name: /^Training load:/ })).toHaveAccessibleName(
      'Training load: Week 1 1205, Week 2 675, Week 3 so far 315',
    )

    // Training paces estimated from the Starting point, in km/h by default.
    const paces = main.getByRole('region', { name: 'Training paces' }).getByRole('table')
    await expect(paces.getByRole('columnheader')).toHaveText(['Pace', 'min/km', 'km/h'])
    await expect(paces.getByRole('row', { name: /^Race run/ })).toHaveText(/5:0711\.7/)
    await expect(main.getByText('Estimated from your Starting point. The Week 2 Compromised run test replaces them.')).toBeVisible()
    await expect(paces.getByRole('row', { name: /^Threshold/ })).toHaveText(/4:5212\.3/)

    // Working weights in pounds: calibrated, then moved by an accepted Suggestion.
    const weights = main.getByRole('region', { name: 'Working weights' }).getByRole('table')
    await expect(weights.getByRole('columnheader')).toHaveText(['Lift', 'First', 'Now', 'Last change'])
    await expect(weights.getByRole('row')).toHaveText([
      /^Lift/,
      'Squat185 lb190 lbWeek 2: +5 lb, every rep at RPE 7 or easier',
      'RDL135 lb135 lbWeek 1: calibrated',
    ])

    // Recovery: the last 14 nights, short ones in the alert colour.
    const recovery = page.getByRole('img', { name: /^Sleep and HRV/ })
    await expect(recovery).toHaveAccessibleName(
      'Sleep and HRV for the last 14 nights: 13 from the ring, 2 under 6 hours. Last night 5 h 41 and HRV 38 ms.',
    )
    await expect(recovery.locator('rect[fill="var(--alert)"]')).toHaveCount(2)
    await expect(recovery.getByText('Last night: 5 h 41 · 38 ms')).toBeVisible()

    // HYROX stations: no Race simulation yet, so the first one's date, and the sled push's own split in Week 1's round.
    const stations = main.getByRole('region', { name: 'HYROX stations' })
    await expect(stations).toContainText('No Race simulation yet. The first is Week 16, the week of Mon 22 Feb.')
    await expect(stations.getByRole('row', { name: /^Sled push/ })).toHaveText('Sled push3:1025 m · W1')
    await expect(stations.getByRole('row', { name: /^Sled pull/ })).toHaveText('Sled pull–Not timed')
    await expect(stations.getByRole('row', { name: /^SkiErg/ })).toHaveText('SkiErg–Not timed')

    // The charts draw at the full width of their panel.
    for (const chart of [page.getByRole('img', { name: /^Training load:/ }), recovery]) {
      const svg = (await chart.boundingBox())!
      const slot = (await chart.locator('xpath=..').boundingBox())!
      expect(Math.abs(svg.width - slot.width)).toBeLessThanOrEqual(1)
    }

    await expectNoAxeViolations(page)
  })
}

test('desktop lays the panels on twelve columns; a phone stacks them', async ({ page }, testInfo) => {
  await page.goto('/progress')
  const box = async (name: string) => (await page.getByRole('region', { name }).boundingBox())!
  const fiveK = await box('5K vs. sub-22')
  const completion = await box('Weekly completion')
  if (testInfo.project.name === 'desktop') {
    // Eight columns beside four, on one row.
    expect(completion.y).toBeCloseTo(fiveK.y, 0)
    expect(fiveK.width / completion.width).toBeGreaterThan(1.8)
    // Recovery beside Working weights, half each; HYROX stations the full width.
    const recovery = await box('Recovery')
    const weights = await box('Working weights')
    expect(weights.y).toBeCloseTo(recovery.y, 0)
    expect(weights.width).toBeCloseTo(recovery.width, 0)
    expect((await box('HYROX stations')).width).toBeGreaterThan(recovery.width * 1.9)
  } else {
    expect(completion.y).toBeGreaterThan(fiveK.y + fiveK.height - 1)
    expect(completion.width).toBeCloseTo(fiveK.width, 0)
  }
})

test('the paces table follows the speed unit', async ({ page }) => {
  await page.addInitScript(() =>
    localStorage.setItem('compromised:settings', JSON.stringify({ unit: 'mph', theme: 'system' })),
  )
  await page.goto('/progress')
  const paces = page.getByRole('region', { name: 'Training paces' }).getByRole('table')
  await expect(paces.getByRole('columnheader')).toHaveText(['Pace', 'min/km', 'mph'])
  await expect(paces.getByRole('row', { name: /^Threshold/ })).toHaveText(/4:527\.7/)
})

test('before any data for them, the new panels say what fills them', async ({ page }) => {
  await serveHistory(page, [{ week: 1, sessionId: 'hyrox-a', date: '2026-11-09', status: 'done', rpe: 7 }])
  await page.clock.setFixedTime(WEEK_3)
  await page.goto('/progress')
  const main = page.getByRole('main')
  const panel = (name: string) => main.getByRole('region', { name })

  await expect(panel('Recovery')).toContainText('No nights from the ring yet.')
  await expect(panel('Recovery').getByRole('img')).toHaveCount(0)
  await expect(panel('Working weights')).toContainText('No Working weights yet.Week 1’s Strength session finds them.')
  await expect(panel('HYROX stations')).toContainText('No Race simulation yet. The first is Week 16, the week of Mon 22 Feb.')
  await expect(panel('HYROX stations').getByRole('table')).toHaveCount(0)
  await expectNoAxeViolations(page)
})
