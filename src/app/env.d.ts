interface ImportMetaEnv {
  /** `mock` in a mock build (ADR-0005): the API answers in the browser. Unset otherwise. */
  readonly VITE_API?: 'mock'
}

/**
 * Mock mode, src/mock/browser.ts, by an alias in vite.config.ts. Imported
 * only behind `import.meta.env.VITE_API === 'mock'`, so no other build holds it.
 */
declare module 'virtual:compromised-mock' {
  export function startMock(): Promise<void>
  export function saveDownload(href: string): Promise<void>
}
