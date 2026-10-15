import type { Locator, Page } from '@playwright/test'

/**
 * Makes a Bucket row today's: its sheet, then Do it today. On a touch screen
 * the sheet opens two frames after the tap, and a paused clock runs no
 * frames: pick first, then pause.
 */
export async function doToday(page: Page, row: Locator) {
  await row.click()
  await page.getByRole('dialog').getByRole('button', { name: /^Do it today/ }).click()
}

/** Where a clock that is paused after a pick starts: early enough that the pause is still ahead. */
export const aMinuteBefore = (time: Date) => new Date(time.getTime() - 60_000)
