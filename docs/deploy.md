# Deploying to production

Production is one Cloudflare Worker, `compromised`, on the free `compromised.<your-subdomain>.workers.dev` address. It serves the built app and the API, with the D1 database `compromised` bound as `DB`. Cloudflare Access sits in front of the whole address, so the only way in is an email one-time code sent to Victor (ADR-0001). Everything here fits in Cloudflare's free plans.

Steps 1 to 6 happen once. After that, shipping a change is just [Deploy](#deploy) (and [Migrate](#migrate) when a change adds a migration).

## Commands

| Command | What it does |
| --- | --- |
| `npm run deploy` | Runs the unit tests, builds the app and the Worker (`dist/`), then `wrangler deploy` uploads the Worker with `dist/client` as its static assets. |
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

Later steps add the narrow exceptions ADR-0001 describes: a service token for the iOS Shortcuts, on the recovery path ([step 7](#7-recovery-shortcut-victor)) and the workout path ([step 8](#8-workout-shortcut-victor)).

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

### 7. Recovery Shortcut (Victor)

The morning iOS Shortcut posts last night's Recovery data to `/api/recovery` (ADR-0003). It can't sign in with an email code, so it carries an Access service token, which the Worker checks too. Do the steps in this order: **merging to `main` deploys production** (Workers Builds), and the deployed code reads the `recovery_nights` table, so the migration goes first.

#### 7a. Before merging: migrate (terminal, on the PR's branch)

```bash
npm run db:migrate:prod
```

It lists `0008_recovery_nights.sql` and asks to confirm: answer yes. The migration only adds a table, so the code running now keeps working. Then merge the PR; Workers Builds deploys it. Until 7c is done, `/api/recovery` answers 401 to everything, which is harmless.

#### 7b. Create the service token (Cloudflare Zero Trust)

1. Open [one.dash.cloudflare.com](https://one.dash.cloudflare.com) and pick your team.
2. **Access → Service Auth** (in the newer menu: **Access controls → Service credentials**) → **Service Tokens** → **Create Service Token**.
3. Name `Recovery Shortcut`. Duration **Non-expiring** (or 1 year, with a calendar reminder to rotate it).
4. **Generate token.** Copy the **Client ID** and the **Client Secret** into your password manager now: the secret is never shown again.

#### 7c. Let it through on the recovery path only

1. **Access → Applications → Add an application → Self-hosted.**
2. Application name `Compromised recovery`.
3. Public hostname: the same host as the `Compromised` application (`compromised.<your-subdomain>.workers.dev`), with **Path** `api/recovery`.
4. Skip the login methods; nothing signs in here.
5. Add a policy: name `Recovery Shortcut`, **Action: Service Auth**, Include → selector **Service Token** → value `Recovery Shortcut`. Save the policy, then the application.

Access uses the most specific path, so the token reaches `/api/recovery` and nothing else, and the rest of the site still asks for your email code.

#### 7d. Give the Worker its copy of the token (terminal)

```bash
npx wrangler secret put ACCESS_CLIENT_ID
```

Paste the Client ID when asked. Then:

```bash
npx wrangler secret put ACCESS_CLIENT_SECRET
```

Paste the Client Secret. `npx wrangler secret list` should list both. Secrets survive later deploys. Behind Access only the Client ID is compared: Access checks the secret at the edge, then vouches for the token with a signed assertion the Worker verifies against `ACCESS_TEAM_DOMAIN` (`wrangler.jsonc`). The secret is compared only where nothing sits in front, as in local dev.

#### 7e. Check it (terminal)

```bash
curl -i -X POST https://compromised.<your-subdomain>.workers.dev/api/recovery -H 'content-type: application/json' -H 'CF-Access-Client-Id: <client id>' -H 'CF-Access-Client-Secret: <client secret>' -d '{"date":"2026-01-01","sleepMinutes":450,"hrvMs":52,"restingHeartRate":48,"source":"Ultrahuman"}'
```

- `200` with `{"ok":true,...}`: done. The test night is dated 1 January, long before the Program, so the Coach never reads it.
- `302` or `403` from Access: the 7c policy doesn't match (path, or the token chosen).
- `401` from the Worker (a JSON `error`): Access let the token through, but the Worker didn't recognize it. Behind Access the Worker checks Access's signed assertion (`Cf-Access-Jwt-Assertion`) and compares its Client ID with `ACCESS_CLIENT_ID`, so check that secret first (`npx wrangler secret put ACCESS_CLIENT_ID` again), and that `ACCESS_TEAM_DOMAIN` in `wrangler.jsonc` is your team's login address.

#### 7f. Build the Shortcut (iPhone)

The app has the same steps with your address filled in: Today → your initial (Settings) → **Recovery Shortcut setup**.

1. **Shortcuts** app → **Shortcuts** tab → **+**. Tap the name at the top → **Rename** → `Compromised recovery`.
2. Sleep. Add **Find Health Samples**: **Type is Sleep**, **Start Date is in the last 2 days**, **Value is not Awake**, **Value is not In Bed**. No Source filter: it doesn't match reliably, and the server merges the Watch's and the ring's overlapping entries anyway.
3. Add **Repeat with Each** (input: Health Samples). Inside it, add **Text** and insert **Repeat Item** → tap it → **Start Date**, Date Format **ISO 8601** with the time; type a space; insert **Repeat Item** → **End Date**, the same format.
4. After **End Repeat**, add **Combine Text**: **Repeat Results**, with **New Lines**. **Set Variable** → `Sleep`.
5. HRV. **Find Health Samples**: **Type is Heart Rate Variability**, **Start Date is in the last 1 day**; **Sort by** Start Date, **Latest First**, **Limit** 1. **Get Details of Health Sample** → **Value**. **Set Variable** → `HRV`. The same for **Resting Heart Rate** → `RHR`.
6. Send. **Get Contents of URL**, URL `https://compromised.<your-subdomain>.workers.dev/api/recovery`. Tap **Show More**:
   - **Method** POST.
   - **Headers** → `CF-Access-Client-Id` = the Client ID; `CF-Access-Client-Secret` = the Client Secret (no trailing space or line break: Cloudflare answers a bare `400 Bad Request` page to a malformed header).
   - **Request Body** JSON: **Text** `sleep` = Sleep; **Number** `hrvMs` = HRV; **Number** `restingHeartRate` = RHR; **Text** `source` = `Ultrahuman`. No date: the night counts for the day it arrives, in Toronto.
7. If Shortcuts says the action is trying to share too many Health items: Settings → Apps → Shortcuts → Advanced → **Allow Sharing Large Amounts of Data**.
8. Add **Show Result** for the first run and tap ▶. Allow the Health data and **Always Allow** the connection. The result should be `{"ok":true,"night":{...}}` with `sleepMinutes` close to the Time Asleep the Health app shows. `No sleep in Apple Health from the ring yet` means nothing has synced: open the Ultrahuman app, run again. Then remove **Show Result**.
9. **Automation** tab → **+** → **Time of Day** → a little after you usually wake and open the Ultrahuman app, **Daily** → **Run Immediately** → **Next** → `Compromised recovery` → **Done**.

The server merges overlapping entries (each minute counts once, as Health's own total does) and keeps only the latest night: entries more than 3 hours before the next belong to the night before. Sending `sleepMinutes` instead of `sleep` still works.

#### 7g. The next morning

Open the app → Settings → Recovery Shortcut setup: **Last night received** shows this morning's date with the same sleep, HRV and resting heart rate as the Ultrahuman app. If it's yesterday's, the automation ran before the ring synced: run the Shortcut by hand and move the automation later.

### 8. Workout Shortcut (Victor)

Apple Watch workouts reach the app through a second iOS Shortcut, which posts each one from Apple Health to `/api/activities` (ADR-0004; Strava's API needs a paid subscription). It uses the **same service token** as the Recovery Shortcut, so step 7 must be done first. Same order as before: migrate, merge, then open the path in Access.

#### 8a. Before merging: migrate (terminal, on the PR's branch)

```bash
npm run db:migrate:prod
```

It lists `0009_activities.sql` and asks to confirm: answer yes. It only adds two tables. Then merge the PR; Workers Builds deploys it. Until 8b is done, Access stops the Shortcut at the edge, which is harmless.

#### 8b. Let the token through on the workout path too (Cloudflare Zero Trust)

1. [one.dash.cloudflare.com](https://one.dash.cloudflare.com) → **Access → Applications** → `Compromised recovery` → **Configure** (or Edit).
2. Under the public hostnames, **+ Add public hostname**: the same host (`compromised.<your-subdomain>.workers.dev`), **Path** `api/activities`. Save.

If your dashboard won't take a second hostname on one application, make a new one instead, exactly like 7c: Self-hosted, name `Compromised workouts`, the same host with **Path** `api/activities`, and a policy **Action: Service Auth**, Include → **Service Token** → `Recovery Shortcut`.

No new Worker secret: the Worker already has the token's copy from 7d.

#### 8c. Check it (terminal)

```bash
curl -i -X POST https://compromised.<your-subdomain>.workers.dev/api/activities -H 'content-type: application/json' -H 'CF-Access-Client-Id: <client id>' -H 'CF-Access-Client-Secret: <client secret>' -d '{"type":"Walking","start":"2026-01-01T12:00:00-05:00","end":"2026-01-01T12:10:00-05:00"}'
```

- `200` with `{"ok":true,...}`: done. A walk on 1 January, before the Program, matches no Session, so the Coach ignores it.
- `302` or `403` from Access: 8b's path doesn't match. Check for a typo in `api/activities`, and that the token chosen is `Recovery Shortcut`.
- `401` from the Worker: the same causes as in 7e.

#### 8d. Build the Shortcuts and automations (iPhone)

Shortcuts can't read a workout back from Health (there's no Workouts type in **Find Health Samples**), so the Apple Watch Workout automation does the timing: one automation saves when a workout starts, others send it when it ends, with the heart rate and distance Health has for that window. The app has the same steps with your address filled in: Today → your initial (Settings) → **Workout Shortcut setup**.

1. **Start Shortcut.** Shortcuts → **+** → name it `Compromised workout start`:
   1. **Date** (Current Date).
   2. **Format Date**: **ISO 8601**, with the time.
   3. **Save File**: to the **Shortcuts** folder in iCloud Drive, **Ask Where to Save** off, **Subpath** `compromised-workout-start.txt`, **Overwrite If File Exists** on.
2. **Send Shortcut.** **+** → name it `Compromised workouts`. In its ⓘ details, turn on **Receive** Text as input (if there's none: Continue). Then:
   1. **Wait** 60 seconds: the watch syncs its samples to the phone after the workout.
   2. **Get File** from the Shortcuts folder, with the **exact** name step 1 saves (check it in the Files app; a typo returns nothing, silently) → **Get Text from Input** → **Set Variable** `Start`. Don't use **Get Dates from Input**: it misreads ISO dates (it turned `14:35:33-04:00` into two wrong times).
   3. **Date** (Current Date) → **Format Date** **ISO 8601** with the time → **Set Variable** `End`.
   4. **Find Health Samples**: **Type is Heart Rate**, **Start Date is in the last 4 hours** (a fixed window: Shortcuts can't filter on a date read back from text) → **Repeat with Each**: a **Text** with Repeat Item → **Value**, a space, Repeat Item → **Start Date** (tap it → **ISO 8601**, with the time) → after **End Repeat**, **Combine Text** Repeat Results with **New Lines** → **Set Variable** `HR`. The server keeps only the samples between start and end.
   5. **Find Health Samples**: **Type is Walking + Running Distance**, **Start Date is in the last 4 hours** → **Repeat with Each**: a **Text** with Repeat Item → **Value**, a space, **Unit**, a space, **Start Date** (ISO 8601, with the time), a space, **Source** → after **End Repeat**, **Combine Text** Repeat Results with **New Lines** → **Set Variable** `Distance`. (The phone and the watch both log distance; the server counts one device only.)
   6. **Get Contents of URL**: `https://compromised.<your-subdomain>.workers.dev/api/activities`, **Method** POST, the two headers from the Recovery Shortcut, **Request Body** JSON: **Text** `type` = Shortcut Input; **Text** `start` = Start; **Text** `end` = End; **Text** `heartRates` = HR; **Text** `distanceSamples` = Distance.
   7. While setting up, **Show Result** (Contents of URL) at the end: Get Contents of URL doesn't stop on an error, so without it a refused workout fails silently. Remove it once workouts arrive.
3. **Start automation.** **Automation** → **+** → **Apple Watch Workout** → **Any** workout, **Is Started** → **Run Immediately** → `Compromised workout start`.
4. **End automations, one per workout type you start on the watch.** **Automation** → **+** → **Apple Watch Workout** → that type (for example **Running**), **Is Ended** → **Run Immediately** → **Text** with the type's name exactly as the list shows it → **Run Shortcut** `Compromised workouts`, input the Text. Likely types:
   - **Running**: Speed, Threshold, Easy runs and 5K tests.
   - **Traditional Strength Training**: Strength only.
   - **Functional Strength Training**, **Mixed Cardio** or **Mixed Metabolic Cardio Training**: HYROX, a Race simulation, or Strength.
   - Anything else (a walk) never matches a Session, so it needs no automation.
5. Apple Watch automations only know **Running**, not indoor or outdoor, so the treadmill months in Settings decide: in those months a run asks for the console distance. Leave that prompt if a run was actually outside.
6. Do a short Running workout. About a minute after it ends, Settings → Workout Shortcut setup → **Last workout received** should show it. The first run asks for Health access and the connection: allow both, **Always Allow**. If nothing arrives, open the automation's last run in Shortcuts to see which step failed.

#### 8e. The first real workout

Do a Session with the watch, then open Today:

- The Session's row in This Week shows `Watch, <day>: <minutes> min · <km> · avg <bpm> bpm`.
- If more than one Session of that type could be it (say Speed and Threshold both still Planned), Today asks **Which Session was this?**. Tap the right one, or **None of these**.
- A treadmill run asks **What did the console say?**. **Add console distance** opens Log after with the watch's minutes filled in.

For `npm run dev`, copy `.dev.vars.example` to `.dev.vars`: any pair of values works locally.

## Deploy

```bash
npm run deploy
```

## Migrate

When a change adds a file to `migrations/`, apply it to production before deploying the code that needs it:

```bash
npm run db:migrate:prod
npm run deploy
```

Branch previews need nothing: mock mode applies every file in `migrations/` on start.

Migrations should only add things (new tables, new nullable columns) so the running version keeps working between the two commands.

## Branch previews

Every PR branch gets a preview from Workers Builds, built with `VITE_API=mock npm run build` (the non-production build command from [step 6](#6-preview-urls-victor)). That is the same build as `npm run build:mock`: mock mode, as in `npm run dev:mock` (README, "Mock mode"; ADR-0005). Mock Service Worker answers every `/api/*` request in the browser from SQLite in the tab, so a preview never reads or writes a real Session log, and a **MOCK** badge shows on every screen. Production's build command stays `npm run build`, which holds none of it (`npm run check:no-mocks`).

A preview opens on the default scenario, `midweek-mixed` (Thursday of Week 5). To see another state of the Program, add `?scenario=<name>` to the preview's address, for example `https://<preview>-compromised.<your-subdomain>.workers.dev/?scenario=race-week`, or pick one under **Mock scenario** at the top of the settings popover (tap your initial on Today). Switching wipes the tab's data and loads the scenario fresh. Tap the badge for the mock panel: network modes, and Recovery night and Apple Watch workout sends.

The preview's Worker itself still binds `DB` to production, since `wrangler.jsonc` gives previews no database of their own. The app never reaches it (every `/api/*` request stops in the browser), so only a request made outside the app, behind Access, would.

## Rolling back

```bash
npx wrangler rollback
```

Puts the previous Worker version back. It does not undo migrations: D1 Time Travel can restore the database to an earlier minute (`npx wrangler d1 time-travel restore compromised --timestamp=<unix seconds>`).
