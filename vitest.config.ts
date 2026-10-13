import { defineConfig } from 'vitest/config'

// The Coach and the Program are plain TypeScript and components render to
// static markup, so unit tests run in Node without the Workers runtime or a
// browser. Playwright owns e2e/.
export default defineConfig({
  test: {
    include: ['src/**/*.test.{ts,tsx}'],
    environment: 'node',
  },
})
