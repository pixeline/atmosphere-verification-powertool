# Account Card Parity, Verifier Checkmarks, Activity Signals & Filters — Design

**Status:** Approved (pending written spec review)
**Date:** 2026-07-08
**Author:** Alexandre Plennevaux (with Claude)

Five related changes bundled into one implementation pass: (1) give Backlog
cards the same display as Search result cards, (2) replace the "Verified by"
text badge with per-verifier colored checkmarks, (3) add followers/following/
last-active signals to every account, (4) a timeframe filter on last-active,
and (5) a default-on filter that excludes accounts already verified by this
org.

---

## Part 1: Backlog Card Parity

### Problem

`GET /vidi/api/backlog` returns only `{subjectDid, note}` — no profile data
at all. The Backlog page renders a bare `did:plc:...` string per row, unlike
Search's `AccountCard`, which shows handle, display name, bio, domain/indexed
badges, and verifier info.

### What it does

`GET /vidi/api/backlog` is enriched the same way the search route already
enriches its results: a `LEFT JOIN` from `backlog_items` to `accounts` (for
profile fields) and the same `accountVerifications` LEFT JOIN
`trustedVerifiers`/`orgs` pattern (for verifier info) used in
`src/app/api/search/route.ts`. The Backlog page renders `AccountCard` per
item (reusing the exact same component Search uses), with "Mark verified"
and "Skip" as the two per-card actions, replacing the current bare layout.

An account queued in the backlog is — by construction — always already in
`accounts` (Tasks 6–8 of the live-search feature guarantee this: both the
verify and backlog-add code paths upsert into `accounts` before or as part of
queueing), so the join is not expected to ever miss profile data for a
backlog row in practice. If a row's account somehow isn't indexed (e.g. rows
inserted before that guarantee existed), `AccountCard` already degrades
gracefully — it only requires `did` and `handle`, and treats every other
field as optional.

---

## Part 2: Verified-By Checkmarks

### Problem

`AccountCard` currently shows one text badge: `Verified by handle1, handle2`.
This doesn't scale visually past 2–3 verifiers and doesn't scan quickly.

### What it does

Each verifier renders as a small colored checkmark icon instead of text, with
the verifier's handle (or DID, if handle is unknown) as a native `title`
tooltip. Color is deterministic per verifier DID — a small hash function maps
the DID string to one of a fixed palette (8 colors, cycling), so the same
verifier always renders the same color everywhere without needing a new
database column or admin-assigned color. This is pure presentation: no API
or schema change for this part specifically (verifier `did`/`handle` are
already returned by both the search and — after Part 1 — backlog routes).

---

## Part 3: Activity Signals (Followers / Following / Last Active)

### Problem

Cards show no signal about how established or active an account is —
followers, who they follow, or whether they're still posting.

### What it does

Three new columns on `accounts`:
- `followers_count integer` — from the profile's `followersCount`.
- `follows_count integer` — from the profile's `followsCount` ("following").
- `last_active_at timestamptz` — timestamp of the account's most recent post.
- `last_active_checked_at timestamptz` — when Vidi last attempted to refresh
  `last_active_at` (bookkeeping column, not shown in the UI).

`followers_count`/`follows_count` are populated for free: `getProfiles`
(already called by `hydrateAccounts` for every crawled account) already
returns both fields on `ProfileViewDetailed`. `toAccountRow` is extended to
copy them across; `upsertAccountRow`'s `onConflictDoUpdate` set list is
extended to keep them fresh on every re-crawl, matching how `handle`/
`displayName`/etc. are already refreshed.

`last_active_at` requires a new per-account call —
`app.bsky.feed.getAuthorFeed({actor: did, limit: 1})` — since Bluesky's
lexicon has no direct "last active" field, and `getAuthorFeed` has no
multi-actor batch form (unlike `getProfiles`, which handles 25 at once).
Calling this for every account on every crawl would multiply the crawl's
network calls by the account count (~800+ today) and risks the public
AppView's rate limits. **New crawler phase**, `refreshLastActive`, runs
after hydration:

1. Select accounts where `last_active_checked_at IS NULL OR last_active_checked_at < now() - interval '7 days'`.
2. For each (per-account try/catch, matching the existing resilience
   pattern in `hydrateAccounts`/`runKeywordSeed`): call `getAuthorFeed`,
   read `feed[0]?.post.record.createdAt` (undefined if the account has no
   posts), and write `last_active_at` (null if no posts) +
   `last_active_checked_at = now()` regardless of outcome — including the
   no-posts case, so an account with zero posts isn't re-checked every
   single crawl for the next 7 days.
3. A failure calling `getAuthorFeed` for one account is logged (naming the
   DID) and skipped; it is NOT stamped with `last_active_checked_at`, so
   it's retried on the very next crawl rather than waiting out the 7-day
   window on a transient failure.

`AccountCard` renders a compact signals line: `N following · N followers ·
Active {relative time}` (e.g. "Active 3 days ago"), or "Active date unknown"
when `last_active_at` is null. No date-formatting library is added (none is
currently a dependency) — a small hand-rolled relative-time helper (days/
weeks/months buckets) is enough for this one display, consistent with this
project's existing preference for plain, dependency-free implementations
where the need is simple. Both the search route and (after Part 1) the
backlog route already `SELECT *` (or equivalent) from `accounts`, so these
new columns flow through to the client with no route changes beyond
confirming the select isn't column-limited.

---

## Part 4: Timeframe Filter (Search)

### What it does

A new segmented control next to the existing "Search in" scope toggle:
**Active within: 7 days / 30 days / 90 days / Any time** (default: Any
time). Maps to a new `SearchFilters.activeWithinDays: number | null` field.
`queryBuilder.buildConditions` adds a
`gte(accounts.lastActiveAt, now() - interval)` condition when set. Only
applies to the local (harvested-accounts) search path — like "Verified by"
and "Followed by a verified account", this is structurally a local-index-only
signal (live network results have no `last_active_at` since they aren't
indexed yet), so it is disabled and cleared when "Live network" scope is
selected, exactly like the two existing graph-dependent filters.

---

## Part 5: Exclude-Already-Verified-By-Us Filter (Search, default on)

### What it does

A checkbox, **checked by default**: "Hide accounts already verified by us".
Maps to `SearchFilters.excludeVerifiedByUs: boolean` (default `true` in
`SearchForm`'s initial state — the only filter in this app defaulting to an
active/on state). When true, the search route resolves the current org's own
DID (a new lookup: `db.select().from(orgs).where(eq(orgs.id, orgId))`,
mirroring the existing lookup pattern in `GET /vidi/api/org/context`) and
`queryBuilder` adds a `NOT EXISTS (SELECT 1 FROM account_verifications WHERE
verifier_did = :orgDid AND subject_did = accounts.did)` condition.

This applies to Search only, not Backlog — Backlog is a queue of accounts
specifically intended for verification, and a backlog item becoming already-
verified through some other path is a rare edge case, not the common case
this filter is guarding against (repeatedly seeing the same, already-handled
accounts while searching for new candidates).

---

## Testing (all parts)

- Backlog route: enrichment query returns the same shape as search
  (handle/displayName/description/isCustomDomain/verifiers), unit-tested with
  the same recording-mock pattern already used for `search.test.ts`.
- Backlog page: renders `AccountCard`, "Mark verified"/"Skip" still work.
- Verifier checkmarks: same DID always maps to the same color (pure function,
  directly unit-tested); handle appears in title attribute.
- `toAccountRow`: followers/follows counts copied through; existing
  `hydrate.test.ts` extended, not replaced.
- `refreshLastActive`: unit-tested with a mocked agent — only stale/null
  accounts selected; per-account try/catch isolates one failure; no-posts
  case still stamps `last_active_checked_at`.
- `queryBuilder`: new unit tests for `activeWithinDays` (each bucket) and
  `excludeVerifiedByUs` (present/absent org DID rows).
- `SearchForm`: timeframe control disables/clears with live-network scope
  like the existing two graph filters; exclude-verified checkbox defaults to
  checked.

## Out of scope / YAGNI

- No manual "refresh last-active now" trigger — it rides the existing crawl
  schedule/manual-trigger, same as every other crawler-sourced signal.
- No configurable staleness window (hardcoded 7 days) — matches this
  project's existing convention of hardcoded, documented constants over
  premature configurability (e.g. the existing 25-result live-search cap).
- No color-picker/admin control over verifier checkmark colors — deterministic
  hash assignment only.
- No "last active" signal for live-network (not-yet-indexed) results — they
  have no crawl history to draw it from; consistent with Part 4's live-network
  exclusion.
