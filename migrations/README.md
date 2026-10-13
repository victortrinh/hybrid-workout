# D1 migrations

Numbered SQL files applied in order by Wrangler. Create one with:

```bash
npx wrangler d1 migrations create compromised <short_description>
```

Apply them to the local database with `npm run db:migrate:local` and to production with `npm run db:migrate:prod` (see [docs/deploy.md](../docs/deploy.md)). Never edit a migration that has already been applied to production; add a new one.
