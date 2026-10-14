# Compromised

A personal training coach for one athlete's 27-week Program toward a sub-20 5K and a HYROX Men's Open race on Wednesday 21 April 2027. It turns the approved Program ([docs/training-plan.md](docs/training-plan.md)) into what to do today.

The front end is Vite, React 19, Tailwind v4 and react-aria-components. The API is Hono on Cloudflare Workers with a D1 database, and the same Worker serves the built app. Domain terms are defined in [CONTEXT.md](CONTEXT.md), design rules in [DESIGN.md](DESIGN.md), and decisions in [docs/adr/](docs/adr/).

## Requirements

- Node.js 22.12 or newer
- For the end-to-end tests, Playwright's Chromium: `npx playwright install chromium`

No Cloudflare account is needed to run anything locally. Wrangler runs the Worker and a local D1 database on your machine.

## Run

```bash
npm install
npm run db:migrate:local
npm run dev
```

This opens the app at http://localhost:5173 with hot reload. The Worker runs alongside it in workerd, so `/api/*` and the D1 binding work in development too (try http://localhost:5173/api/health). Local D1 data is kept in `.wrangler/state`; run `npm run db:migrate:local` again whenever `migrations/` gains a file.

### Mock mode

```bash
npm run dev:mock
```

The app with no Worker or database behind it, for QA ([ADR-0005](docs/adr/0005-qa-mocks-msw-over-in-browser-hono.md)). Mock Service Worker answers every `/api/*` request in the browser with the Worker's own Hono app, on SQLite in WebAssembly (sql.js) with every migration applied. Data lives in the tab's session storage: it survives a reload and goes when the tab closes. A **MOCK** badge on every screen says so. The Shortcut routes take the mock service token's headers, `CF-Access-Client-Id: mock-shortcut.access` and `CF-Access-Client-Secret: mock-shortcut-secret` (`src/mock/api.ts`).

Mock mode starts in a **scenario**: a day of the Program with everything the server and the device would hold by then (`src/mock/scenarios`). The default is `midweek-mixed`, Thursday of Week 5. Pick another with `?scenario=<name>`, for example `http://localhost:5173/?scenario=race-week`, or from **Mock scenario** at the top of the settings popover. A switch wipes the app's IndexedDB and local storage, loads the scenario fresh and pins the clock to its day. A name it doesn't know falls back to the default, and the badge says so. The scenarios: `before-program`, `week1-start`, `after-baseline`, `midweek-mixed`, `rollover`, `deload`, `activities-pending`, `hyrox-build`, `dense-history`, `race-week` and `after-race`. Each file's comment says what it's for.

`npm run build:mock` builds the same thing into `dist/`. Mock builds don't register the offline service worker (`/sw.js`), since a page has only one service worker and Mock Service Worker is it. Nothing of mock mode reaches a normal build; CI checks with `npm run check:no-mocks`.

## Test

```bash
npm test
```

Runs the Vitest unit tests. Most of them cover the Coach (`src/domain/coach.ts`): the Program calendar, Week boundaries in America/Toronto, days to Race day, Phase completion and Up next.

```bash
npm run test:e2e
```

Runs Playwright with axe against the real Worker. It builds the app, starts `wrangler dev` on port 8790 with a fresh local D1 in `.wrangler-e2e`, and checks Today, Plan and Progress at 390 px and 1440 px wide, in light and dark, for WCAG 2.2 AA violations. Tests pin the clock with Playwright's clock API, so results don't depend on today's date.

```bash
npm run check
```

Type-checks the app, the Worker and the tooling.

GitHub Actions runs all three on every pull request and on pushes to `main` (`.github/workflows/ci.yml`). When the end-to-end step fails, the Playwright report and traces are uploaded as an artifact.

## Build

```bash
npm run build
```

Writes the static app to `dist/client` and the Worker to `dist/compromised`.

```bash
npm run preview
```

Builds, then serves that build from the Worker with `wrangler dev` (http://localhost:8787), the same way production will.

## Deploy

```bash
npm run deploy           # test, build, then wrangler deploy
npm run db:migrate:prod  # apply new migrations to the production D1
```

Production is the Worker on its workers.dev address, behind Cloudflare Access with an email one-time code. The one-time setup (Wrangler sign-in, the production database, the Access application) is in [docs/deploy.md](docs/deploy.md).

## Layout

```
src/domain/   Pure TypeScript: calendar (local dates in Toronto), the Program as data, the Coach
src/app/      The React app: shell, screens, components, design tokens (styles.css)
src/worker/   The Hono API and the Worker entry
src/mock/     Mock mode: the Worker's app in the browser, on sql.js (ADR-0005)
migrations/   D1 migrations, applied with Wrangler
scripts/      Small Node scripts (check:access, check:no-mocks)
e2e/          Playwright + axe specs
prototype/    The approved clickable prototype (reference only)
```

The Coach takes the Program and a local date and returns the day: it never reads a clock. The app converts "now" to a date in America/Toronto once (`localDateIn`) and passes that in.

After changing `wrangler.jsonc`, regenerate the Worker types with `npm run cf-typegen`.
