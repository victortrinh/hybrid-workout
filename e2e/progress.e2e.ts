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
  // A Starting point estimate kept on this device: the baseline test's splits replace it.
  await page.addInitScript(() =>
    localStorage.setItem(
      'compromised:starting-point',
      JSON.stringify({ point: { splitSeconds: 330, weights: {}, updatedAt: '2026-11-05T12:00:00.000Z' }, pending: false }),
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
      'Projected finish',
      'Weekly completion',
      'Station bests',
      'Race run pace',
      'Training paces',
      'Training load',
      'Recovery',
      'Working weights',
      'HYROX stations',
    ]) {
      await expect(main.getByRole('heading', { level: 2, name })).toBeVisible()
    }
    // Nothing from the old goal: no race distance in K, no sub-NN time, no goal line.
    await expect(main).not.toContainText(/\b\dK\b|sub-\d\d|goal/i)

    // Projected finish: the race in nine lanes. The baseline test fills the runs; Week 1's sled push was 25 m,
    // half of race volume, so its lane is half full and there's no time.
    const projected = main.getByRole('region', { name: 'Projected finish' })
    await expect(projected).toContainText('1of 9 lanes full')
    await expect(projected).toContainText('No projection yet.')
    const lanes = projected.getByRole('list', { name: 'The race in lanes' }).getByRole('listitem')
    await expect(lanes).toHaveCount(9)
    await expect(lanes.first()).toHaveText('Runs · 8 × 1 km5:07/km W2')
    await expect(lanes.filter({ hasText: 'Sled push' })).toHaveText('Sled push · 50 m1:35 for 25 m · W2')
    await expect(lanes.filter({ hasText: 'Wall balls' })).toHaveText('Wall balls · 100 reps2:50 for 50 reps · W2')
    await expect(projected).not.toContainText(/\d:\d\d:\d\d/)

    // Station bests: eight tiles at race volume, none set yet.
    const bests = main.getByRole('region', { name: 'Station bests' })
    await expect(bests).toContainText('0 of 8 set.')
    await expect(bests.getByRole('listitem')).toHaveCount(8)
    await expect(bests.getByRole('listitem', { name: 'Sled push' })).toHaveText('Sled push · 50 m–No best yet')
    await expect(bests.getByRole('listitem', { name: 'Wall balls' })).toHaveText('Wall balls · 100 reps–No best yet')

    // Race run pace from the baseline Compromised run test: the average of its four runs.
    await expect(page.getByRole('img', { name: /^Race run pace:/ })).toHaveAccessibleName('Race run pace: 5:07/km in Week 2.')
    await expect(main.getByRole('region', { name: 'Race run pace' })).toContainText('Next test Week 9.')

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

    // Training paces from the baseline test's four runs, over the Starting point's estimate, in km/h by default.
    const paces = main.getByRole('region', { name: 'Training paces' }).getByRole('table')
    await expect(paces.getByRole('columnheader')).toHaveText(['Pace', 'min/km', 'km/h'])
    await expect(paces.getByRole('row', { name: /^Race run/ })).toHaveText(/5:0711\.7/)
    await expect(main.getByText('From your latest Compromised run test: the average of its four runs.')).toBeVisible()
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
    await expect(stations.getByRole('row', { name: /^SkiErg/ })).toHaveText('SkiErg–Not timed')

    // The charts draw at the full width of their panel.
    for (const chart of [
      page.getByRole('img', { name: /^Training load:/ }),
      page.getByRole('img', { name: /^Race run pace:/ }),
      recovery,
    ]) {
      const svg = (await chart.boundingBox())!
      const slot = (await chart.locator('xpath=..').boundingBox())!
      expect(Math.abs(svg.width - slot.width)).toBeLessThanOrEqual(1)
    }

    await expectNoAxeViolations(page)
  })
}

test('desktop lays the panels on twelve columns; a phone stacks them', async ({ page }, testInfo) => {
  await page.goto('/progress')
  // Measured in the type the athlete reads: until Archivo swaps in, the fallback wraps a line more,
  // and a box read before the swap does not meet one read after it.
  await expect(page.getByRole('region', { name: 'Station bests' })).toBeVisible()
  await page.evaluate(() => document.fonts.ready)
  const box = async (name: string) => (await page.getByRole('region', { name }).boundingBox())!
  const projected = await box('Projected finish')
  const completion = await box('Weekly completion')
  const bests = await box('Station bests')
  if (testInfo.project.name === 'desktop') {
    // The Projected finish leads, eight columns beside four, on one row; the Station bests below, the full width.
    expect(completion.y).toBeCloseTo(projected.y, 0)
    expect(projected.width / completion.width).toBeGreaterThan(1.8)
    expect(bests.y).toBeGreaterThan(projected.y + projected.height - 1)
    expect(bests.width).toBeGreaterThan(projected.width * 1.4)
    // Recovery beside Working weights, half each.
    const recovery = await box('Recovery')
    const weights = await box('Working weights')
    expect(weights.y).toBeCloseTo(recovery.y, 0)
    expect(weights.width).toBeCloseTo(recovery.width, 0)
  } else {
    expect(completion.y).toBeGreaterThan(projected.y + projected.height - 1)
    expect(completion.width).toBeCloseTo(projected.width, 0)
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
  await expect(panel('Race run pace')).toContainText('No Compromised run test yet. The first is Week 2.')
  await expect(panel('Race run pace').getByRole('img')).toHaveCount(0)
  await expect(panel('Projected finish')).toContainText('0of 9 lanes full')
  await expect(panel('Projected finish')).toContainText('Runs · 8 × 1 kmNo test yet')
  await expectNoAxeViolations(page)
})

/** Every Station at full volume and Race load, as the Week 16 and 18 Race simulations log it. */
const FULL = [
  ['skierg', 240, { meters: 1000 }],
  ['sled-push', 180, { meters: 50, pounds: 335 }],
  ['sled-pull', 200, { meters: 50, pounds: 225 }],
  ['burpee-broad-jumps', 250, { meters: 80 }],
  ['row', 245, { meters: 1000 }],
  ['farmers-carry', 90, { meters: 200, pounds: 55 }],
  ['sandbag-lunges', 260, { meters: 100, pounds: 45 }],
  ['wall-balls', 330, { reps: 100, pounds: 13 }],
] as const

const simulation = (week: number, date: string, legs: typeof FULL[number][]): SeedLog => ({
  week,
  sessionId: 'race-simulation',
  date,
  status: 'done',
  minutes: 65,
  rpe: 8,
  stations: legs.flatMap(([part, seconds, done], i) => [
    { round: i + 1, part: 'run', pounds: null, meters: 1000, reps: null, seconds: 300 },
    { round: i + 1, part, pounds: 'pounds' in done ? done.pounds : null, meters: 'meters' in done ? done.meters : null, reps: 'reps' in done ? done.reps : null, seconds },
  ]),
})

test('with all eight Station bests at full volume, Progress leads with the Projected finish and its Doubles share', async ({ page }) => {
  // The baseline test (Race run pace 5:07), then the two half simulations: Σ Stations 1795 s = 29:55.
  await serveHistory(page, [
    ...BASELINE_HISTORY,
    simulation(16, '2027-02-27', FULL.slice(0, 4)),
    simulation(18, '2027-03-13', FULL.slice(4)),
  ])
  await page.clock.setFixedTime(new Date('2027-03-15T12:00:00-04:00'))
  await page.goto('/progress')
  const projected = page.getByRole('main').getByRole('region', { name: 'Projected finish' })

  // Solo: 1795 + 8 × 307 + 360 = 4611 s. Doubles: 897.5 + 2456 + 360 = 3713.5 s.
  await expect(projected.getByRole('definition').first()).toHaveText('1:16:51')
  await expect(projected.getByRole('term')).toHaveText(['Solo', 'Doubles share'])
  await expect(projected.getByRole('definition').nth(1)).toHaveText('1:01:54')
  await expect(projected).toContainText('eight runs at 5:07/km from Week 2’s test, and 6:00 of transitions.')
  await expect(projected.getByRole('list', { name: 'Where the time goes' }).getByRole('listitem')).toHaveText([
    'Stations 29:55',
    'Running 40:56',
    'Transitions 6:00',
  ])
  // The race as one tape, each run and its Station in order.
  await expect(projected.getByRole('img')).toHaveAccessibleName(/^The race in order: 1 km 5:07, SkiErg 4:00; .*Wall balls 5:30; then 6:00 of transitions\.$/)

  const bests = page.getByRole('main').getByRole('region', { name: 'Station bests' })
  await expect(bests).toContainText('All eight set.')
  await expect(bests.getByRole('listitem', { name: 'Row' })).toHaveText('Row · 1000 m4:05W18')
  await expectNoAxeViolations(page)
})
