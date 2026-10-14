import { defineConfig, devices } from '@playwright/test'

const PORT = 8790
const BASE_URL = `http://localhost:${PORT}`
/** A clean local D1 for every run, apart from the one `npm run dev` uses. */
const PERSIST_DIR = '.wrangler-e2e'

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.e2e.ts',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
    // The athlete's phone. The app computes days in Toronto whatever the device
    // says; one test moves the browser to Tokyo to prove it.
    timezoneId: 'America/Toronto',
    locale: 'en-CA',
    // Lanes fill with a transition; without motion the page is still and the scan deterministic.
    contextOptions: { reducedMotion: 'reduce' },
  },
  webServer: {
    // The real thing: the production build served by the Worker, with D1 bound and migrated.
    command: [
      `rm -rf ${PERSIST_DIR}`,
      'npm run build',
      `npx wrangler d1 migrations apply compromised --local --persist-to ${PERSIST_DIR}`,
      `npx wrangler dev --port ${PORT} --persist-to ${PERSIST_DIR} --show-interactive-dev-session=false`,
    ].join(' && '),
    url: `${BASE_URL}/api/health`,
    timeout: 120_000,
    reuseExistingServer: !process.env.CI,
  },
  projects: [
    {
      name: 'phone',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 390, height: 844 },
        deviceScaleFactor: 3,
        isMobile: true,
        hasTouch: true,
      },
    },
    {
      name: 'desktop',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
    },
  ],
})
