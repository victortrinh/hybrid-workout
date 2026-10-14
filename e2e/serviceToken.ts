/** The Access service token the e2e Worker checks on /api/recovery (playwright.config.ts passes it as vars). */
export const E2E_SERVICE_TOKEN = { id: 'e2e-client.access', secret: 'e2e-secret' }

/** The two headers the iOS Shortcut sends. */
export const serviceTokenHeaders = (token = E2E_SERVICE_TOKEN) => ({
  'CF-Access-Client-Id': token.id,
  'CF-Access-Client-Secret': token.secret,
})
