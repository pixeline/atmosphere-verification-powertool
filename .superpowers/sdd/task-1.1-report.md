# Task 1.1 Report: Drizzle setup + schema + migrations

## Status: DONE (GREEN)

Commit: `bcefc68` — "feat(db): drizzle schema, migrations, pg_trgm indexes"

## Tables created (13/13, verified in live Postgres)

`account_signals`, `account_verifications`, `accounts`, `backlog_items`,
`crawl_runs`, `crawl_seeds`, `members`, `oauth_session`, `oauth_state`,
`orgs`, `trusted_verifier_allowlist`, `trusted_verifiers`,
`verification_actions` — all match the brief's table definitions verbatim
(`src/db/schema.ts`), including all specified indexes:
- `accounts_handle_idx` (btree on handle)
- `av_uniq` (unique on account_verifications.subject_did, verifier_did)
- `members_uniq` (unique on members.org_id, member_did)
- `backlog_uniq` (unique on backlog_items.org_id, subject_did)
- unique constraints: `orgs.did`, `crawl_seeds.keyword`

## Files created / changed

- `drizzle.config.ts` — drizzle-kit config (postgresql dialect, schema path, out dir)
- `src/db/schema.ts` — all 13 pgTable definitions, verbatim from brief
- `src/db/client.ts` — `pool` (pg.Pool) + `db` (drizzle node-postgres instance)
- `src/db/migrate.ts` — `runMigrations()` export + ESM-safe CLI entrypoint (see below)
- `drizzle/0000_woozy_zodiak.sql` — generated migration (13 CREATE TABLE + 4 indexes)
- `drizzle/0001_trgm_indexes.sql` — journalled custom migration (pg_trgm extension + 2 GIN indexes)
- `drizzle/meta/_journal.json`, `drizzle/meta/0000_snapshot.json`, `drizzle/meta/0001_snapshot.json` — drizzle-kit migration metadata
- `tests/db/schema.test.ts` — schema smoke test (verbatim from brief)
- `package.json` / `package-lock.json` — added `drizzle-orm`, `pg` (deps); `drizzle-kit`, `@types/pg` (devDeps)

## How the two correctness requirements were solved

### 1. pg_trgm extension + GIN indexes actually run in the migration pipeline

Used the **preferred** approach: generated a real journalled custom migration
via `npx drizzle-kit generate --custom --name trgm_indexes`, which produced
`drizzle/0001_trgm_indexes.sql` and correctly registered it as journal entry
`idx: 1` in `drizzle/meta/_journal.json` (confirmed by inspecting the journal
after generation — both `0000_woozy_zodiak` and `0001_trgm_indexes` are
listed). This means `drizzle-orm/node-postgres/migrator`'s `migrate()` picks
it up automatically like any other migration — no stray/unregistered SQL
file, no hand-editing of `_journal.json`.

File contents (`drizzle/0001_trgm_indexes.sql`):
```sql
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX IF NOT EXISTS accounts_handle_trgm ON accounts USING gin (handle gin_trgm_ops);
CREATE INDEX IF NOT EXISTS accounts_desc_trgm ON accounts USING gin (description gin_trgm_ops);
```
All three statements are idempotent (`IF NOT EXISTS`), so re-running
migrations is safe (verified — see Verification section).

### 2. migrate.ts runnable as CLI in this ESM-adjacent project

Confirmed `package.json` has **no** `"type": "module"` field (defaults to
CommonJS), while `next.config.mjs` uses static ESM syntax and tsconfig uses
`"module": "esnext"` / `"moduleResolution": "bundler"`. Under `tsx`,
`require.main === module` is not a reliable entrypoint check (tsx runs files
through an ESM-capable loader regardless of the CJS default), so instead
`src/db/migrate.ts` uses:

```ts
const isMain = (() => {
  try {
    return import.meta.url === `file://${process.argv[1]}`
  } catch {
    return false
  }
})()
if (isMain) {
  runMigrations().then(() => pool.end()).then(() => process.exit(0)).catch(...)
}
```

`export async function runMigrations()` is preserved for programmatic/test
use. Verified directly: `DATABASE_URL=... npx tsx src/db/migrate.ts` ran to
completion (exit 0, tables + extension + indexes created) — proving the
entrypoint check fires correctly under the actual CI invocation command.

## Verification (against real Postgres, throwaway container)

Started: `docker run -d --rm --name vidi_pg_test -e POSTGRES_USER=vidi -e POSTGRES_PASSWORD=changeme -e POSTGRES_DB=vidi -p 5432:5432 postgres:16-alpine`

1. **Generate migration**: `npx drizzle-kit generate` → `13 tables` reported,
   produced `drizzle/0000_woozy_zodiak.sql` (111 lines, all 13 CREATE TABLE
   statements + 4 indexes/unique constraints matching schema.ts).

2. **Run migration**: `DATABASE_URL=postgres://vidi:changeme@localhost:5432/vidi npx tsx src/db/migrate.ts`
   → completed silently, exit code 0.

3. **Table verification** (`psql \dt`):
   ```
   account_signals, account_verifications, accounts, backlog_items,
   crawl_runs, crawl_seeds, members, oauth_session, oauth_state, orgs,
   trusted_verifier_allowlist, trusted_verifiers, verification_actions
   ```
   13 rows — matches spec exactly.

4. **Extension verification**:
   ```
   SELECT extname FROM pg_extension WHERE extname='pg_trgm';
   → extname
     ---------
     pg_trgm
   (1 row)
   ```

5. **Index verification** (via `pg_indexes`, since `\di` only accepts one
   pattern in this psql build):
   ```
   SELECT indexname, tablename FROM pg_indexes
   WHERE indexname IN ('accounts_handle_trgm','accounts_desc_trgm');
   → accounts_handle_trgm | accounts
     accounts_desc_trgm   | accounts
   (2 rows)
   ```

6. **Idempotency check**: re-ran `npx tsx src/db/migrate.ts` a second time —
   exit code 0, no errors (drizzle skips already-applied migrations via its
   internal `__drizzle_migrations` tracking table; the trgm SQL itself is
   also idempotent via `IF NOT EXISTS`).

7. **Tests**: `npm test` → `Test Files 2 passed (2)`, `Tests 2 passed (2)`
   (pre-existing `tests/health.test.ts` + new `tests/db/schema.test.ts`).
   Ran `tests/db/schema.test.ts` alone in verbose mode to confirm it's not
   silently skipped: `✓ schema > exposes expected tables`.

8. **TypeScript**: `npx tsc --noEmit` — no errors.

9. Stopped and removed the throwaway container: `docker stop vidi_pg_test`
   (container was `--rm`, so it self-removed). No changes made to
   `docker-compose.yml` (host port was never added there, per instructions).

## Test status

RED → GREEN: `tests/db/schema.test.ts` did not exist before this task; on
creation it passed immediately (schema.ts satisfies it directly by
construction). Confirmed passing against the full suite and in isolation.

## Concerns

- **Global gitignore surprise**: `~/.gitignore_global` contains a blanket
  `*.sql` rule, which silently excluded `drizzle/0000_woozy_zodiak.sql` and
  `drizzle/0001_trgm_indexes.sql` from `git add -A`. Caught this before
  committing by diffing staged files against `ls drizzle/`, and used
  `git add -f` to force-add both. Verified with `git show --stat HEAD` that
  both `.sql` files are present in the final commit. Worth flagging to the
  team since any contributor with a similar global gitignore will have the
  same silent-drop problem — future migrations should always be checked with
  `git status --short drizzle/` before committing, not just `git add -A`.
- `npm audit` reports 6 moderate severity vulnerabilities after installing
  `drizzle-kit` (transitive deps) — not addressed here as out of scope for
  this task; flagging for awareness.
- No FK constraints exist between tables (e.g. `members.org_id` -> `orgs.id`)
  because the brief's schema doesn't declare them — matches brief exactly,
  but noting in case referential integrity is expected at the DB level in a
  later task.
