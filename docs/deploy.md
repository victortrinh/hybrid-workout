# Deploying to production

Production is one Cloudflare Worker, `compromised`, on the free `compromised.<your-subdomain>.workers.dev` address. It serves the built app and the API, with the D1 database `compromised` bound as `DB`. Cloudflare Access sits in front of the whole address, so the only way in is an email one-time code sent to Victor (ADR-0001). Everything here fits in Cloudflare's free plans.

Steps 1 to 6 happen once. After that, shipping a change is just [Deploy](#deploy) (and [Migrate](#migrate) when a change adds a migration).

## Commands

| Command | What it does |
| --- | --- |
| `npm run deploy` | Runs the unit tests, builds the app and the Worker (`dist/`), then `wrangler deploy` uploads the Worker with `dist/client` as its static assets. |
| `npm run db:migrate:prod` | Applies any unapplied files in `migrations/` to the production D1 database. Wrangler lists them and asks before applying, and captures a backup first. |
| `npm run db:migrate:preview` | The same against `compromised-preview`, the D1 database branch previews (Workers Builds on a PR) use instead of production. |
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

Later steps add the narrow exceptions ADR-0001 describes: a service token for the iOS Shortcut ([step 7](#7-recovery-shortcut-victor)), and later a bypass for the Strava webhook path.

### 5. Check it (Victor)

From the terminal:

```bash
npm run check:access -- https://compromised.<your-subdomain>.workers.dev
```

Every line should say `ok` and point at `<team>.cloudflareaccess.com`.

Then on your phone, in a private tab: open the address, confirm the Cloudflare Access page asks for your email, enter the code it sends, and check that Today loads with the countdown and Up next. Finally, open `/api/health` in the same tab: it should show `{"ok":true,"db":true}`, which proves the Worker reaches the production database.

### 6. Preview URLs (Victor)

Workers Builds uploads every PR branch as a preview with its own address, `<version or branch>-compromised.<your-subdomain>.workers.dev`, bound to the `compromised-preview` database. Those hostnames aren't covered by the application from step 4, so cover them before the first PR builds:

Workers & Pages → `compromised` → Settings → Domains & Routes → on the **Preview URLs** row, **Enable Cloudflare Access**. Open the application it made in Zero Trust and check it the same way as in step 4: only your email, One-time PIN. (Or add `*-compromised.<your-subdomain>.workers.dev` as a second public hostname of the `Compromised` application.)

Then check a preview the build posts on its PR:

```bash
npm run check:access -- https://<preview>-compromised.<your-subdomain>.workers.dev
```

### 7. Recovery Shortcut (Victor)

The morning iOS Shortcut posts last night's Recovery data to `/api/recovery` (ADR-0003). It can't sign in with an email code, so it carries an Access service token, which the Worker checks too. Do the steps in this order: **merging to `main` deploys production** (Workers Builds), and the deployed code reads the `recovery_nights` table, so the migration goes first.

#### 7a. Before merging: migrate (terminal, on the PR's branch)

```bash
npm run db:migrate:prod
npm run db:migrate:preview
```

Each lists `0008_recovery_nights.sql` and asks to confirm: answer yes. The migration only adds a table, so the code running now keeps working. Then merge the PR; Workers Builds deploys it. Until 7c is done, `/api/recovery` answers 401 to everything, which is harmless.

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
2. Sleep. Add **Find Health Samples**. Tap the filter: **Type is Sleep Analysis**. **Add Filter** → **Source is** → your Ultrahuman ring. **Add Filter** → **Start Date is in the last** 18 hours. **Add Filter** → **Value is not In Bed**, and again **Value is not Awake** (if Value isn't offered, leave it out and check the total in step 9).
3. Add **Get Details of Health Sample** → **Duration**. Add **Calculate Statistics** → **Sum**. Add **Calculate** → ÷ 60 if the sum is in seconds (step 9 tells you). Add **Set Variable** → `Sleep`.
4. HRV. **Find Health Samples**: **Type is Heart Rate Variability**, **Source is** the ring, **Start Date is in the last** 18 hours. **Get Details of Health Sample** → **Value**. **Calculate Statistics** → **Average**. **Set Variable** → `HRV`.
5. Resting heart rate. **Find Health Samples**: **Type is Resting Heart Rate**, **Source is** the ring; **Sort by** Start Date, **Order** Latest First, **Limit** on, 1. **Get Details of Health Sample** → **Value**. **Set Variable** → `RHR`.
6. Date. **Format Date**: **Current Date**, Date Format **Custom**, format string `yyyy-MM-dd`. **Set Variable** → `Morning`.
7. Send. **Get Contents of URL**, URL `https://compromised.<your-subdomain>.workers.dev/api/recovery`. Tap **Show More**:
   - **Method** POST.
   - **Headers** → Add new header: `CF-Access-Client-Id` = the Client ID; again: `CF-Access-Client-Secret` = the Client Secret.
   - **Request Body** JSON → Add new field: **Text** `date` = Morning; **Number** `sleepMinutes` = Sleep; **Number** `hrvMs` = HRV; **Number** `restingHeartRate` = RHR; **Text** `source` = `Ultrahuman`.
8. For the first run only, add **Show Result** at the end.
9. Tap ▶. Allow the Health data it asks for and **Always Allow** the connection. The result should be `{"ok":true,"night":{...}}`, with `sleepMinutes` around 400–500 for a 7–8 hour night (about 7 for a 7 hour night means drop the ÷ 60; about 25,000 means add it). `No sleep in Apple Health from the ring yet` means the ring hasn't synced: open the Ultrahuman app, wait for its sync, run again. Then check Settings → Recovery Shortcut setup → **Last night received** against the Ultrahuman app, and remove **Show Result**.
10. **Automation** tab → **+** (New Automation) → **Time of Day** → a time a little after you usually wake and open the Ultrahuman app (the ring syncs to Health through it), **Daily** → **Run Immediately** (turn **Notify When Run** off if you like) → **Next** → `Compromised recovery` → **Done**.

#### 7g. The next morning

Open the app → Settings → Recovery Shortcut setup: **Last night received** shows this morning's date with the same sleep, HRV and resting heart rate as the Ultrahuman app. If it's yesterday's, the automation ran before the ring synced: run the Shortcut by hand and move the automation later.

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

Apply it to the preview database too, so branch previews of the change work:

```bash
npm run db:migrate:preview
```

Migrations should only add things (new tables, new nullable columns) so the running version keeps working between the two commands.

## Rolling back

```bash
npx wrangler rollback
```

Puts the previous Worker version back. It does not undo migrations: D1 Time Travel can restore the database to an earlier minute (`npx wrangler d1 time-travel restore compromised --timestamp=<unix seconds>`).
