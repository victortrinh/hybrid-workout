# Deploying to production

Production is one Cloudflare Worker, `compromised`, on the free `compromised.<your-subdomain>.workers.dev` address. It serves the built app and the API, with the D1 database `compromised` bound as `DB`. Cloudflare Access sits in front of the whole address, so the only way in is an email one-time code sent to Victor (ADR-0001). Everything here fits in Cloudflare's free plans.

Steps 1 to 6 happen once. After that, merging to `main` ships a change: Workers Builds applies any new migration, then deploys ([Deploy](#deploy)).

## Commands

| Command | What it does |
| --- | --- |
| `npm run deploy` | Runs the unit tests, builds the app and the Worker (`dist/`), applies any unapplied migrations to production, then `wrangler deploy` uploads the Worker with `dist/client` as its static assets. |
| `npm run deploy:cues` | Runs the unit tests, then uploads the cue timer, `compromised-cues` (`wrangler.cues.jsonc`, ADR-0006). Only needed when `src/cues/` changes. |
| `npm run make:vapid-keys -- <mailto:…>` | Prints a new VAPID key pair and the commands that store it as the cue timer's secrets ([step 7](#7-lock-screen-cues-victor)). |
| `npm run db:migrate:prod` | Applies any unapplied files in `migrations/` to the production D1 database. Wrangler lists them and asks before applying, and captures a backup first. |
| `npm run db:migrate:local` | The same against the local D1 that `npm run dev` uses. |
| `npm run check:access -- <url>` | Requests `/`, `/plan` and `/api/health` without signing in and fails unless every one redirects to the Cloudflare Access login. |

Wrangler uses the account you are signed in to (`npx wrangler whoami`), so no account id is stored in the repo.

## First deploy

### 1. Sign in to Cloudflare (Victor)

```bash
npx wrangler login
npx wrangler whoami
```

`login` opens the browser to authorize Wrangler on your free Cloudflare account. `whoami` should print your email and the account.

### 2. Create the production database (Victor)

```bash
npx wrangler d1 create compromised
```

The output includes a `database_id`. If Wrangler offers to add the binding to your config, answer **no**: the binding already exists. Instead, add the id to the existing `DB` entry in `wrangler.jsonc`:

```jsonc
"d1_databases": [
  {
    "binding": "DB",
    "database_name": "compromised",
    "database_id": "<the id Wrangler printed>",
    "migrations_dir": "migrations"
  }
]
```

Commit that change. A D1 id is not a secret (it is useless without credentials for your account), and having it in the repo means every deploy targets the same database.

Then apply the migrations (there may be none yet; Wrangler then says so):

```bash
npm run db:migrate:prod
```

### 3. Deploy (Victor)

```bash
npm run deploy
```

If this account has never used workers.dev, Wrangler asks you to pick a subdomain first. At the end it prints the address, `https://compromised.<your-subdomain>.workers.dev`.

The site is public until step 4 is done, so do step 4 straight away. It only shows the Program, which is fine for a few minutes.

### 4. Put the address behind Cloudflare Access (Victor)

In the Cloudflare dashboard, open **Zero Trust**. The first time, it asks for a team name (this becomes `<team>.cloudflareaccess.com`) and a plan: choose **Free**. It may ask for payment details even on the Free plan.

1. **Turn on the one-time PIN login.** Settings → Authentication → Login methods → Add new → **One-time PIN**.
2. **Create the application.** Access → Applications → Add an application → **Self-hosted**.
   - Name: `Compromised`.
   - Session duration: **1 month**, so the phone doesn't ask for a code every day.
   - Public hostname: `compromised.<your-subdomain>.workers.dev`, with the path left empty so the whole site (app and `/api`) is covered.
   - Login methods: only **One-time PIN**. Turn on instant authentication if it's offered, so the PIN form appears without an extra click.
3. **Add the policy.** Name `Victor only`, action **Allow**, with one Include rule: **Emails** → your email address. No other rules.
4. Save.

Shortcut: Workers & Pages → `compromised` → Settings → Domains & Routes → on the `workers.dev` row, **Enable Cloudflare Access** creates the same application for you. If you use it, open the application it made in Zero Trust and check it against the list above, especially that the policy allows only your email and that One-time PIN is the login method.

Nothing gets past Access without your email code: there is no service token and no path left open (ADR-0011).

### 5. Check it (Victor)

From the terminal:

```bash
npm run check:access -- https://compromised.<your-subdomain>.workers.dev
```

Every line should say `ok` and point at `<team>.cloudflareaccess.com`.

Then on your phone, in a private tab: open the address, confirm the Cloudflare Access page asks for your email, enter the code it sends, and check that Today loads with the countdown and Up next. Finally, open `/api/health` in the same tab: it should show `{"ok":true,"db":true}`, which proves the Worker reaches the production database.

### 6. Preview URLs (Victor)

Workers Builds uploads every PR branch as a preview with its own address, `<version or branch>-compromised.<your-subdomain>.workers.dev`. Previews run in mock mode ([below](#branch-previews)), so they need no database of their own. Those hostnames aren't covered by the application from step 4, so cover them before the first PR builds:

Workers & Pages → `compromised` → Settings → Domains & Routes → on the **Preview URLs** row, **Enable Cloudflare Access**. Open the application it made in Zero Trust and check it the same way as in step 4: only your email, One-time PIN. (Or add `*-compromised.<your-subdomain>.workers.dev` as a second public hostname of the `Compromised` application.)

Then check a preview the build posts on its PR:

```bash
npm run check:access -- https://<preview>-compromised.<your-subdomain>.workers.dev
```

Finally, make previews mock builds: Workers & Pages → `compromised` → Settings → Build → **Non-production branch build command** → `VITE_API=mock npm run build`. Leave the production build command as it is.

Then make production migrate before it deploys, in the same Build settings: **Deploy command** → `npm run db:migrate:prod && npx wrangler deploy`. Code that reads a new table must never go out before the table: on 15 October two migrations were missed, `/api/state` answered 500 for a week, and the app quietly stopped showing new Recovery nights. Leave the non-production deploy command as it is: previews have no database to migrate. If the first build after this fails with an authentication error on the migration, the build's API token can't reach D1: Settings → Build → **API token**, edit it in My Profile → API Tokens and add **Account · D1 · Edit**.

### 7. Lock-screen cues (Victor)

The cue timer sends a Live session's Block changes and rest ends to the phone as push notifications while the app is off screen (ADR-0006). It's a second Worker, `compromised-cues`, with no address of its own; the app's Worker reaches it through its `CUES` binding. Do the steps in this order: **merging to `main` deploys production**, and the app's Worker binds a Durable Object in `compromised-cues`, which has to exist first.

#### 7a. Before merging: deploy the cue timer (terminal, on the PR's branch)

```bash
npm run deploy:cues
```

It lists one binding, `env.CUES (LiveCues)`, and creates the Durable Object class. Then merge the PR; Workers Builds deploys the app. Until 7b is done, Settings says **Not set up on the server yet.**

#### 7b. The VAPID keys (terminal)

The keys sign every push, so Apple's push service knows it comes from this app. The subject is how Apple would reach you about it:

```bash
npm run make:vapid-keys -- mailto:<your email>
```

It prints three `npx wrangler secret put … -c wrangler.cues.jsonc` commands, each with its value. Run each one and paste its value when Wrangler asks. Nothing is written to disk; the private key is shown once. Setting a secret redeploys the cue timer, so there's nothing else to run.

#### 7c. Turn it on (iPhone)

Push only reaches an app on the Home Screen, on iOS 16.4 or later:

1. In Safari, open the app's address, **Share → Add to Home Screen**. Open it from the Home Screen icon from now on.
2. Tap your initial on Today → **Lock-screen cues** → **Turn on**, and **Allow** notifications.

If Settings says **Add Compromised to the Home Screen…**, it's open in a Safari tab, not the Home Screen app. If it says **Notifications are off for Compromised**, iOS Settings → Notifications → Compromised → **Allow Notifications**.

#### 7d. Check it

Start a Session with a short Block (Easy run's warm-up, or the Run's first rep), then switch to another app or lock the phone. When the Block ends, the phone buzzes and the lock screen shows the next Block and its target, with the Coach line under it, for example **Jog · 9.8 km/h** and *Jog. Breathe. Pretend this is easy.* Tapping it opens the Live session. Coming back to the app before then cancels the cue, and the on-screen buzz and beep take over.

No notification? Workers & Pages → `compromised-cues` → **Logs**: a push Apple refused is logged there with its status. Turn Lock-screen cues off and on again to send a fresh subscription.

## Deploy

Merging to `main` deploys: Workers Builds builds the app, applies any new file in `migrations/` to production, then deploys the Worker ([step 6](#6-preview-urls-victor)). If the migration fails, the build stops and the running version stays up. By hand, from the terminal, the same thing (with the unit tests first):

```bash
npm run deploy
```

## Migrate

Deploying applies new migrations first, so a change that adds a file to `migrations/` needs nothing extra. To apply them on their own, ahead of a merge:

```bash
npm run db:migrate:prod
```

Branch previews need nothing: mock mode applies every file in `migrations/` on start.

Migrations should only add things (new tables, new nullable columns) so the running version keeps working between the two commands.

## Branch previews

Every PR branch gets a preview from Workers Builds, built with `VITE_API=mock npm run build` (the non-production build command from [step 6](#6-preview-urls-victor)). That is the same build as `npm run build:mock`: mock mode, as in `npm run dev:mock` (README, "Mock mode"; ADR-0005). Mock Service Worker answers every `/api/*` request in the browser from SQLite in the tab, so a preview never reads or writes a real Session log, and a **MOCK** badge shows on every screen. Production's build command stays `npm run build`, which holds none of it (`npm run check:no-mocks`).

A preview opens on the default scenario, `midweek-mixed` (Thursday of Week 4). To see another state of the Program, add `?scenario=<name>` to the preview's address, for example `https://<preview>-compromised.<your-subdomain>.workers.dev/?scenario=race-week`, or pick one under **Mock scenario** at the top of the settings popover (tap your initial on Today). Switching wipes the tab's data and loads the scenario fresh. Tap the badge for the mock panel: network modes.

The preview's Worker has no `DB` at all: previews take their bindings only from the `previews` block in `wrangler.jsonc`, which holds just `ACCESS_TEAM_DOMAIN`. Wrangler warns that `DB` is missing on each upload; that's expected. A request made outside the app, such as `/api/health` behind Access, fails instead of reaching any database.

## Clean start: wipe and redeploy (Victor confirms)

The 24-week HYROX Program starts from nothing: no Session log, Pain report, Recovery night, Activity, Suggestion decision or Starting point from the old Program is carried over (#157). This is the one time production data is deleted on purpose. Nothing runs it automatically, and no agent runs it: Victor runs these commands, or says go and watches them run. Do it after the HYROX Program is merged to `main` and before the first Session of Week 1 (Monday 9 November 2026).

It empties every table and keeps the database itself, so the `database_id` in `wrangler.jsonc`, the applied-migrations record (`d1_migrations`) and D1 Time Travel all stay, and the wipe can be undone for 30 days.

### 1. Keep a copy

```bash
npx wrangler d1 export compromised --remote --output=compromised-before-clean-start.sql
npx wrangler d1 time-travel info compromised
```

The first writes every table, schema and rows, to a SQL file on your machine. It holds every log, so keep it out of the repo. The second prints the current **bookmark**: write it down, it is the point to restore to. The app's own **Export JSON** in Settings → Your data is a second copy, in the app's words.

### 2. Apply every migration

```bash
npm run db:migrate:prod
```

Wrangler lists any migration not yet applied (the HYROX Program's is `0013_compromised_run_test.sql`) and asks before applying; answer yes. `No migrations to apply` is fine too. The tables now have the new schema: no 5K result column, the Starting point's estimated split.

### 3. Empty every table

Children before parents, `d1_migrations` left alone:

```bash
npx wrangler d1 execute compromised --remote --command "delete from interval_logs; delete from station_logs; delete from set_logs; delete from session_logs; delete from suggestion_decisions; delete from pain_reports; delete from recovery_nights; delete from activity_answers; delete from activities; delete from starting_point;"
```

Wrangler asks before running against the remote database; answer yes. Then check that every table is empty:

```bash
npx wrangler d1 execute compromised --remote --command "select 'session_logs', count(*) from session_logs union all select 'interval_logs', count(*) from interval_logs union all select 'station_logs', count(*) from station_logs union all select 'set_logs', count(*) from set_logs union all select 'suggestion_decisions', count(*) from suggestion_decisions union all select 'pain_reports', count(*) from pain_reports union all select 'recovery_nights', count(*) from recovery_nights union all select 'activities', count(*) from activities union all select 'activity_answers', count(*) from activity_answers union all select 'starting_point', count(*) from starting_point;"
```

Every count should be `0`. The list matches `EXPORT_TABLES` in `src/worker/export.ts`: every table the migrations create. If a later migration adds a table, add it to both commands.

### 4. Deploy

```bash
npm run deploy
```

Runs the unit tests, builds, applies migrations (none left after step 2) and deploys. Skip it if Workers Builds already deployed the merge; it changes nothing then.

### 5. Clear each device

The app keeps Session logs in the phone's IndexedDB and its settings, Starting point and Pain reports in local storage, and a device sends what it holds back on the next sync. So before opening the app again, on every device that has used it:

- **iPhone, Home Screen app:** delete the Compromised icon from the Home Screen, then Settings → Apps → Safari → Advanced → **Website Data**, find `compromised.<your-subdomain>.workers.dev`, swipe to delete. Open the address in Safari and **Add to Home Screen** again. Lock-screen cues need turning on again ([7c](#7c-turn-it-on-iphone)).
- **A desktop browser:** with the app open, the site settings (the icon left of the address) → **Delete data** / **Clear site data**.

### 6. Check it

Open the app. It should show the Starting point screen (no estimated split, no Working weights yet), then Today with Week 1, the countdown to Thursday 22 April 2027 and Up next from HYROX A, HYROX B, Run and Strength. `/api/health` still answers `{"ok":true,"db":true}`.

### Undo

Within 30 days, put the database back as it was before step 3:

```bash
npx wrangler d1 time-travel restore compromised --bookmark=<the bookmark from step 1>
```

The other way to a clean start, deleting and recreating the database (`npx wrangler d1 delete compromised`, then [step 2 of First deploy](#2-create-the-production-database-victor) with the new `database_id` committed), also works, but it loses Time Travel and needs a commit; emptying the tables is the one to use.

## Rolling back

```bash
npx wrangler rollback
```

Puts the previous Worker version back. It does not undo migrations: D1 Time Travel can restore the database to an earlier minute (`npx wrangler d1 time-travel restore compromised --timestamp=<unix seconds>`).

## Removing the Shortcuts (Victor)

The Recovery and Workout Shortcuts are gone (ADR-0011): `/api/recovery` and `/api/activities` answer 404 now. If they were set up, take down what they used. Nothing here is needed for the app to work. It only stops dead requests and removes a credential nothing uses.

1. **iPhone.** In Shortcuts → **Automation**, delete the morning `Compromised recovery` automation and every Apple Watch Workout automation that runs `Compromised workout start` or `Compromised workouts`. Then delete those three Shortcuts.
2. **Cloudflare Zero Trust.** **Access → Applications**: delete `Compromised recovery` (and `Compromised workouts`, if you made it). Keep `Compromised`, which covers the whole site. **Access → Service Auth → Service Tokens**: revoke `Recovery Shortcut`.
3. **The Worker's copy of the token** (terminal):

```bash
npx wrangler secret delete ACCESS_CLIENT_ID
```

```bash
npx wrangler secret delete ACCESS_CLIENT_SECRET
```

4. **Check it** (terminal): without a session, `npm run check:access -- https://compromised.<your-subdomain>.workers.dev` still passes.

The `recovery_nights`, `activities` and `activity_answers` tables stay in D1 with whatever they held. Nothing writes to them or reads them back, but the export still includes them, so that data stays yours to download.
