import { expect, test } from '@playwright/test'
import { expectNoAxeViolations } from './axe'
import { caughtUp, serveHistory } from './history'
import { doToday } from './today'

/** Tuesday 17 November 2026, Week 2. */
const WEEK_2_TUESDAY = new Date('2026-11-17T12:00:00-05:00')

/**
 * Catch-up (ADR-0007): Week 1's HYROX B and Run (Key) were never logged,
 * so they wait, Late, ahead of Week 2, and Up next is the oldest of them.
 */
test('serves the Late sessions first, says how far behind, and still lets a current-Week Session be picked', async ({
  page,
}) => {
  await serveHistory(page, [
    { week: 1, sessionId: 'hyrox-a', date: '2026-11-09', status: 'done' },
    { week: 1, sessionId: 'strength', date: '2026-11-11', status: 'done' },
  ])
  await page.clock.setFixedTime(WEEK_2_TUESDAY)
  await page.goto('/')

  await expect(page.getByRole('heading', { level: 1 })).toHaveText(/^HYROX B, 4\srounds/)
  // Up next's meta line says where it's from.
  const lateMeta = page.locator('p', { hasText: /^Week 1 · Late/ })
  await expect(lateMeta).toBeVisible()
  await expect(page.getByText('2 Sessions behind · Week 1')).toBeVisible()

  const bucket = page.getByRole('list').filter({ hasText: 'Compromised run test' })
  await expect(bucket.getByRole('listitem')).toHaveText([
    /^HYROX B.*Week\s1\s·\sLate.*Next$/,
    /^Run.*Week\s1\s·\sLate.*Key$/,
    /^Strength/,
    /^HYROX B/,
    /^Compromised run test/,
    /^HYROX A/,
    /^Easy run.*Optional$/,
  ])
  // Week 2's own count leaves the Late sessions out.
  await expect(page.getByText('5 Sessions left · 6 days')).toHaveCount(0)
  await expect(page.getByText('4 Sessions left · 6 days')).toBeVisible()
  await expectNoAxeViolations(page)

  // Week 2's HYROX A instead, today: the Late sessions stay, still counted.
  await doToday(page, bucket.getByRole('listitem').nth(5).getByRole('button'))
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(/^HYROX A/)
  await expect(lateMeta).toHaveCount(0)
  await expect(bucket.getByRole('listitem').first()).toHaveText(/^HYROX B.*Week\s1\s·\sLate/)
  await expect(bucket.getByRole('listitem').nth(1)).toHaveText(/^Run.*Week\s1\s·\sLate.*Key$/)
  await expect(page.getByText('2 Sessions behind · Week 1')).toBeVisible()
})

/**
 * Week 1's Strength is done Late on the Week 2 Monday, and only the Late Run
 * is left: the Coach suggests leaving it for a day, as a rest the athlete can
 * tap past (ADR-0007).
 */
test('only suggests resting a Late Run the day after Strength', async ({ page }) => {
  await serveHistory(page, [
    { week: 1, sessionId: 'hyrox-a', date: '2026-11-09', status: 'done' },
    { week: 1, sessionId: 'hyrox-b', date: '2026-11-11', status: 'done' },
    { week: 1, sessionId: 'strength', date: '2026-11-16', status: 'done' },
  ])
  await page.clock.setFixedTime(WEEK_2_TUESDAY)
  await page.goto('/')

  const upNext = page.getByRole('heading', { level: 1 })
  await expect(upNext).toHaveText('Rest suggested.')
  await expect(page.getByText('The Run on legs that just lifted? Better tomorrow. Your call.')).toBeVisible()
  await expect(page.getByText('1 Session behind · Week 1')).toBeVisible()
  await page.getByRole('button', { name: 'Do it anyway' }).click()
  await expect(upNext).toHaveText(/^Run, 3\s×\s7′/)
  await expect(page.locator('p', { hasText: /^Week 1 · Late/ })).toBeVisible()
})

/**
 * A watch run on the Week 2 Tuesday fits both Week 1's Late Run and Week
 * 2's Compromised run test: Today asks, naming each with its Week, and the
 * answer attaches it to the Late row.
 */
test('asks which Week’s Session a watch workout was when it fits a Late one and a current one', async ({ page }) => {
  const activityAnswers: Record<string, unknown>[] = []
  await serveHistory(
    page,
    [
      ...['hyrox-a', 'hyrox-b', 'strength'].map((sessionId) => ({ week: 1, sessionId, date: '2026-11-10', status: 'done' as const })),
      ...['hyrox-a', 'easy'].map((sessionId) => ({ week: 2, sessionId, date: '2026-11-16', status: 'done' as const })),
    ],
    [],
    {
      activities: [
        {
          id: '2026-11-17T12:00:00Z',
          date: '2026-11-17',
          startedAt: '2026-11-17T12:00:00Z',
          workoutType: 'Running',
          kind: 'run',
          minutes: 40,
          distanceMeters: 8000,
          averageHeartRate: null,
          maxHeartRate: null,
          indoor: false,
          receivedAt: '2026-11-17T13:00:00.000Z',
        },
      ],
      activityAnswers,
    },
  )
  await page.clock.setFixedTime(WEEK_2_TUESDAY)
  await page.goto('/')

  const question = page.getByRole('region', { name: 'Which Session was this?' })
  await expect(question.getByRole('button')).toHaveText(['Run · Week 1', 'Compromised run test · Week 2', 'None of these'])
  await expectNoAxeViolations(page)

  await question.getByRole('button', { name: 'Run · Week 1' }).click()
  await expect(question).toHaveCount(0)
  await expect.poll(() => activityAnswers.at(-1)).toMatchObject({ week: 1, sessionId: 'run' })
  await expect(page.getByRole('region', { name: 'From the watch' })).toContainText('Run it was. Not logged yet.')
  const bucket = page.getByRole('list').filter({ hasText: 'Compromised run test' })
  await expect(bucket.getByRole('listitem').first()).toHaveText(/^Run.*Week\s1\s·\sLate.*Watch/)
})

/** Monday 22 February 2027: Week 16, the first day of Race specific. */
const RACE_SPECIFIC_MONDAY = new Date('2027-02-22T12:00:00-05:00')

/**
 * Race day doesn't move (ADR-0007): on the first Monday of Race specific the
 * Sessions still Late are dropped, said once, and Up next is Week 16's.
 */
test('drops what is still Late as Race specific starts, and says so once', async ({ page }) => {
  // Week 14's Compromised run test and Strength and Week 15's Strength never logged.
  const decisions: Record<string, unknown>[] = []
  await serveHistory(
    page,
    caughtUp(13, [
      { week: 14, sessionId: 'hyrox-a', date: '2027-02-08', status: 'done' },
      { week: 14, sessionId: 'hyrox-b', date: '2027-02-10', status: 'done' },
      ...['hyrox-a', 'hyrox-b', 'run'].map((sessionId) => ({
        week: 15,
        sessionId,
        date: '2027-02-16',
        status: 'done' as const,
      })),
    ]),
    [],
    { suggestionDecisions: decisions },
  )
  await page.clock.setFixedTime(RACE_SPECIFIC_MONDAY)
  await page.goto('/')

  const notice = page.getByText('3 Sessions from Weeks 14–15 dropped to keep Race specific on schedule.')
  await expect(notice).toBeVisible()
  await expect(page.getByText(/Sessions? behind/)).toHaveCount(0)
  await expect(page.locator('p', { hasText: /· Late/ })).toHaveCount(0)
  const bucket = page.getByRole('list').filter({ hasText: 'Strength' })
  await expect(bucket.getByRole('listitem').first()).toHaveText(/^Strength.*Next$/)
  await expect(bucket.getByRole('listitem').nth(3)).toHaveText(/^Race simulation/)
  await expectNoAxeViolations(page)

  await page.getByRole('button', { name: 'Got it' }).click()
  await expect(notice).toHaveCount(0)
  await page.reload()
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  await expect(notice).toHaveCount(0)
})
