# Crawl Isolation & Signal Simplification — Design

**Date:** 2026-07-09
**Status:** Approved

## Problem

Production incident: every recent crawl (runs 6–10) failed to finish, and the
app container repeatedly crashed with `FATAL ERROR: Ineffective mark-compacts
near heap limit — JavaScript heap out of memory`. All 838 accounts have
`followers_count`, `follows_count`, and `last_active_at` = NULL — the crawl
never reached the phases that populate them.

Two root causes:

1. **The web server runs the crawl in-process.** The "Run crawl now" button
   (`POST /api/crawl/run`) calls `runCrawl()` fire-and-forget *inside the Next.js
   app process*. When the crawl OOMs, it takes the whole site down. (A separate
   `worker` container already runs the *scheduled* crawl out-of-process via
   `scheduler.ts` — only the manual trigger leaks into the app process.)

2. **The follows-discovery seed set is unbounded.** `run.ts` seeds
   `collectFollowedByVerified` with `verifierDids ∪ verifiedSubjects` — currently
   **6,749 DIDs** (only ~10–16 are real verifiers). Each seed does a fully
   paginated `getFollows` accumulating into one growing in-memory `Map` for the
   whole run → the heap exhaustion.

## Decisions

Three decisions, all confirmed with the product owner:

1. **Isolate the crawl from the web server** via an enqueue/worker split.
2. **Remove the "followed by a verified account" / "verified by" filter feature
   entirely** — this deletes the unbounded follows-crawl phase at its source,
   rather than trying to bound it.
3. **Drop `followers_count` / `follows_count`** from the data model (the
   "followers/following" signals were deemed too brittle to be worth the cost).

`last_active_at` and the "Active within" filter are **kept** — that feature only
appeared broken because the crawl OOM'd before reaching `refreshLastActive`.

## Change 1 — Crawl isolation (enqueue → worker)

**New table `crawl_requests`:**

```ts
export const crawlRequests = pgTable('crawl_requests', {
  id: serial('id').primaryKey(),
  requestedByDid: text('requested_by_did'),
  requestedAt: timestamp('requested_at', { withTimezone: true }).defaultNow(),
  claimedAt: timestamp('claimed_at', { withTimezone: true }), // null = pending
})
```

**`POST /api/crawl/run`** — stops calling `runCrawl()`. Instead inserts a
`crawl_requests` row and returns `{ ok: true, queued: true }`. Authz unchanged
(`assertOwner`). The app process must never import or call `runCrawl` again.

**`scheduler.ts`** — gains a poll alongside the existing cron:

- A module-level `let running = false` guard shared by both cron and poll so a
  crawl never runs twice concurrently in the one worker process.
- A `runCrawlGuarded()` wrapper: if `running`, skip (log and return); else set
  `running = true`, run `runCrawl()`, clear `running` in `finally`.
- The existing `cron.schedule(expr, ...)` calls `runCrawlGuarded()`.
- A new `setInterval` (default 30s, `VIDI_CRAWL_POLL_MS`) claims the oldest
  unclaimed request — `UPDATE crawl_requests SET claimed_at = now() WHERE id =
  (SELECT id FROM crawl_requests WHERE claimed_at IS NULL ORDER BY id LIMIT 1)
  RETURNING id` — and, if it claimed one, calls `runCrawlGuarded()`. Claiming
  before running means a request is consumed even if the run then errors (a
  failed run should not loop forever on the same request).

Single worker container → the in-process `running` boolean is sufficient; the
`claimed_at` column additionally makes request consumption durable/idempotent.

## Change 2 — Remove the "followed by verified" / "verified by" filter

**Delete:**
- `src/crawler/followsCrawl.ts` + `tests/crawler/followsCrawl.test.ts`
- The follows-crawl phase in `run.ts`: the `seedDids` loop building
  `followedMap`, and the `accountSignals` upsert loop.
- The `account_signals` table (schema + migration `DROP TABLE`).
- `followedByVerified` and `verifiedByAnyOf` from `SearchFilters` and their
  two `buildConditions` branches in `queryBuilder.ts` (and the now-unused
  `accountSignals` import there).
- In `SearchForm.tsx`: the "Followed by a verified account" checkbox, the
  "Verified by" fieldset, the `followedByVerified`/`verifiedByAnyOf` state, the
  `trustedVerifiers` prop, and their entries in the `onSubmit` payload and
  `setScope` clearing.
- In `search/page.tsx`: the `tvs` state, the `/api/trusted-verifiers` fetch
  effect, the `TV` type, and the `trustedVerifiers={tvs}` prop.

**Keep (untouched):**
- `crawlVerifications` / `verificationsCrawl.ts`, the `account_verifications`
  table, and `syncTrustedVerifiers` / the `trusted_verifiers` table — these feed
  the **per-verifier checkmarks on cards**, which stay.
- `excludeVerifiedByUs` ("Hide accounts already verified by us") and
  `activeWithinDays` ("Active within") filters.
- The `GET /api/trusted-verifiers` route itself (verify during implementation
  that nothing else consumes it; leave in place if unused — out of scope).

## Change 3 — Drop followers/following columns

- Migration: `ALTER TABLE accounts DROP COLUMN followers_count, DROP COLUMN
  follows_count;` (combined with the `account_signals` DROP in one migration).
- Remove `followersCount`/`followsCount` from: `db/schema.ts`,
  `crawler/hydrate.ts` (`AccountRow`, `toAccountRow`, `upsertAccountRow`),
  `lib/verify/verifyService.ts`, `app/api/backlog/route.ts` (GET select + POST
  upsert), `components/AccountCard.tsx` (the signals line), and
  `app/(app)/search/page.tsx` (the `Account` type).
- `AccountCard`'s signals line becomes just `{describeLastActive(acc.lastActiveAt)}`.
- Update the 4 test files that reference these fields:
  `tests/ui/accountCard.test.tsx`, `tests/crawler/hydrate.test.ts`,
  `tests/lib/verifyService.test.ts`, `tests/api/backlog.test.ts`.

## Testing

- Unit: `crawl_requests` insert on manual trigger (route test), `queryBuilder`
  no longer emits follows/verified-by conditions, `AccountCard` renders without
  follower/following counts, `hydrate`/`verifyService`/`backlog` upserts omit the
  dropped columns.
- The scheduler poll/guard logic gets a focused test (claim-oldest, skip-when-
  running, skip-when-none-pending) with a mocked `db` and `runCrawl`.
- Full suite green + `tsc --noEmit` clean.
- Post-deploy verification: trigger a crawl, confirm `crawl_runs.finished_at`
  gets set, `accounts.last_active_at` becomes populated, and the app container
  does not restart.

## Out of scope

- Per-network-call timeouts (the ETIMEDOUT stalls are no longer fatal once the
  crawl is out-of-process and the unbounded phase is gone).
- Any change to `crawlVerifications`, `keywordSeed`, `hydrateAccounts`, or
  `refreshLastActive` behavior beyond removing the dropped-column writes.
