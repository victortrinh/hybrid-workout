interface ImportMetaEnv {
  /** `mock` in a mock build (ADR-0005): the API answers in the browser. Unset otherwise. */
  readonly VITE_API?: 'mock'
}

/**
 * Mock mode, src/mock/browser.ts, by an alias in vite.config.ts. Imported
 * only behind `import.meta.env.VITE_API === 'mock'`, so no other build holds it.
 */
declare module 'virtual:compromised-mock' {
  export function startMock(): Promise<import('./mockInfo').MockInfo>
  /** Reloads into `name`, fresh. */
  export function switchScenario(name: string): void
  export function saveDownload(href: string): Promise<void>
}
