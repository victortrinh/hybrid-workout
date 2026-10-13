# Deploying to production

Production is one Cloudflare Worker, `compromised`, on the free `compromised.<your-subdomain>.workers.dev` address. It serves the built app and the API, with the D1 database `compromised` bound as `DB`. Cloudflare Access sits in front of the whole address, so the only way in is an email one-time code sent to Victor (ADR-0001). Everything here fits in Cloudflare's free plans.

Steps 1 to 4 happen once. After that, shipping a change is just [Deploy](#deploy) (and [Migrate](#migrate) when a change adds a migration).

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

Later issues add the narrow exceptions ADR-0001 describes (a service token for the iOS Shortcut, a bypass for the Strava webhook path). Don't add any now.

### 5. Check it (Victor)

From the terminal:

```bash
npm run check:access -- https://compromised.<your-subdomain>.workers.dev
```

Every line should say `ok` and point at `<team>.cloudflareaccess.com`.

Then on your phone, in a private tab: open the address, confirm the Cloudflare Access page asks for your email, enter the code it sends, and check that Today loads with the countdown and Up next. Finally, open `/api/health` in the same tab: it should show `{"ok":true,"db":true}`, which proves the Worker reaches the production database.

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

Migrations should only add things (new tables, new nullable columns) so the running version keeps working between the two commands.

## Rolling back

```bash
npx wrangler rollback
```

Puts the previous Worker version back. It does not undo migrations: D1 Time Travel can restore the database to an earlier minute (`npx wrangler d1 time-travel restore compromised --timestamp=<unix seconds>`).
