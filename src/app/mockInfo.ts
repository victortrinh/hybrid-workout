/**
 * What the app shows of mock mode (ADR-0005): the scenario on the badge, and
 * the scenarios the settings picker offers. Set once by main.tsx before the
 * first render, in mock builds only; null everywhere else.
 */
export interface MockInfo {
  scenario: string
  /** A `?scenario=` that named no scenario, so the default stood in. */
  unknown: string | null
  scenarios: { name: string; summary: string }[]
}

let info: MockInfo | null = null

export const setMockInfo = (next: MockInfo) => {
  info = next
}

export const mockInfo = (): MockInfo | null => info
