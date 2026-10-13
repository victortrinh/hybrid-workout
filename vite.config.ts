import { cloudflare } from '@cloudflare/vite-plugin'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// One dev server for everything: Vite serves the app with HMR and the
// Cloudflare plugin runs the Worker (Hono + D1) in workerd beside it.
export default defineConfig({
  plugins: [react(), tailwindcss(), cloudflare()],
})
