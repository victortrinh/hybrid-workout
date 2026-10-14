/**
 * Renders the PNG app icons from public/icons/icon.svg with Playwright's
 * Chromium. Run after changing the SVG: `node scripts/make-icons.mjs`.
 */
import { readFile } from 'node:fs/promises'
import { chromium } from '@playwright/test'

const dir = new URL('../public/icons/', import.meta.url)
const svg = await readFile(new URL('icon.svg', dir), 'utf8')
const browser = await chromium.launch()
const page = await browser.newPage()
for (const [name, size] of [
  ['icon-192.png', 192],
  ['icon-512.png', 512],
  ['apple-touch-icon.png', 180],
]) {
  await page.setViewportSize({ width: size, height: size })
  await page.setContent(`<style>*{margin:0}svg{display:block;width:${size}px;height:${size}px}</style>${svg}`)
  await page.screenshot({ path: new URL(name, dir).pathname })
}
await browser.close()
