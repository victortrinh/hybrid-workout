import { cloudflare } from '@cloudflare/vite-plugin'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { createHash } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { msw } from 'msw/vite'
import { fileURLToPath } from 'node:url'
import { defineConfig, loadEnv, type Plugin } from 'vite'

// One dev server for everything: Vite serves the app with HMR and the
// Cloudflare plugin runs the Worker (Hono + D1) in workerd beside it.
//
// Mock mode (`--mode mock`, or VITE_API=mock; ADR-0005) answers /api/* in the
// browser instead: Mock Service Worker's script is served and built in place
// of /sw.js, and `virtual:compromised-mock` resolves to src/mock/browser.ts.
export default defineConfig(({ mode }) => {
  const mock = loadEnv(mode, process.cwd(), 'VITE_').VITE_API === 'mock'
  return {
    plugins: [react(), tailwindcss(), cloudflare(), mock ? msw({ mode: 'worker-only' }) : serviceWorker()],
    resolve: {
      alias: { 'virtual:compromised-mock': fileURLToPath(new URL('src/mock/browser.ts', import.meta.url)) },
    },
  }
})

/**
 * Emits /sw.js (from src/sw/sw.js) into the client build with the list of
 * every built and public file to precache, and a version that changes
 * whenever any of their contents do. Builds only: in dev there's no worker,
 * so HMR is never served stale.
 */
function serviceWorker(): Plugin {
  return {
    name: 'compromised:service-worker',
    apply: 'build',
    generateBundle(_, bundle) {
      if (this.environment.name !== 'client') return
      const hash = createHash('sha256')
      const files = ['/']
      for (const [fileName, output] of Object.entries(bundle).sort(([a], [b]) => a.localeCompare(b))) {
        // Source maps and dotfiles (the Cloudflare plugin's .assetsignore) are never served.
        if (fileName.endsWith('.map') || fileName.split('/').pop()!.startsWith('.')) continue
        hash.update(fileName).update(output.type === 'chunk' ? output.code : output.source)
        if (fileName !== 'index.html') files.push(`/${fileName}`)
      }
      const publicDir = this.environment.config.publicDir
      for (const file of walk(publicDir)) {
        hash.update(file).update(readFileSync(file))
        files.push(`/${relative(publicDir, file)}`)
      }
      const source = readFileSync('src/sw/sw.js', 'utf8')
        .replace('/* precache */ []', JSON.stringify(files))
        .replace("/* version */ 'dev'", JSON.stringify(hash.digest('hex').slice(0, 12)))
      this.emitFile({ type: 'asset', fileName: 'sw.js', source })
    },
  }
}

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true })
    .flatMap((entry) => (entry.isDirectory() ? walk(join(dir, entry.name)) : [join(dir, entry.name)]))
    .sort()
}
