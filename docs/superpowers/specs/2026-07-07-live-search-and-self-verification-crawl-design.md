# Live Network Search + Self-Verification Crawl — Design

**Status:** Approved (pending written spec review)
**Date:** 2026-07-07
**Author:** Alexandre Plennevaux (with Claude)

Two related fixes bundled into one implementation pass: (1) let search optionally
reach beyond the local index into the live atproto network, and (2) close a gap
where an org's own self-verifications never get rediscovered by the crawler.

---

## Part 1: Live Network Search

### Problem

Search only ever queries Vidi's local `accounts` index, which is only as complete
as whatever the crawler has discovered so far (currently ~800 accounts from a
narrow keyword/follows seed). A user searching for a string like "namur" gets
zero results if nothing matching that string has been crawled yet, even though
matching accounts genuinely exist on the network.

### What it does

A "Search the live network too" checkbox in the search filters. When checked,
in addition to the local index query, Vidi also queries Bluesky's public AppView
in real time for accounts matching the text query.

### Scope constraint

Live search only ever applies to **text-in-bio/handle** and **handle-is-a-domain**.
"Verified by" and "followed by a verified account" are structurally local-index-only
signals — there is no atproto API to answer "who verifies this account" or "who
follows this account" cheaply across arbitrary search results; those two exist
only because the crawler has pre-built and joined that graph itself.

When the live-network checkbox is checked:
- The "Verified by" fieldset and "Followed by a verified account" checkbox
  become disabled.
- If either was previously checked, it is cleared (not silently ignored) so the
  UI never implies a filter is active when it structurally cannot be honored.

### API

- `app.bsky.actor.searchActors` (general-purpose full-profile search — matches
  bio + handle) is used, NOT `searchActorsTypeahead` (prefix-only, capped ~100,
  built for autocomplete, already used by the crawler's keyword seeding).
- Called against the same public AppView agent pattern already used in
  `verifyService.ts` (`VIDI_PUBLIC_APPVIEW_URL`, default
  `https://public.api.bsky.app`). That agent construction is extracted into one
  shared helper (`src/lib/atproto/publicAgent.ts`) since two call sites now need
  it — avoids duplicating `new AtpAgent({...})` construction.
- Capped at 25 live results per search, single page, no pagination (YAGNI for v1).
- Requires non-empty text (the API needs a query). If the checkbox is on but the
  text field is empty, the live portion is silently skipped — local filters still
  run normally. A small caption near the checkbox states this requirement.

### Merging (server-side, in the existing route)

`POST /vidi/api/search` gains a `liveNetwork: boolean` field on `filters`. When
true, after the existing local `searchAccounts(filters)` call:
1. If `filters.text` is non-empty, call the live search helper (capped at 25).
2. Filter live results client-side (server-side in the route) by
   `isCustomDomain` if that filter is also checked — reusing the existing
   `isCustomDomain` classifier from `src/lib/domain/handleClassifier.ts`.
3. Merge local + live result sets, **deduped by DID** — if an account appears in
   both, keep the local (indexed) version, since it may already carry richer
   data.
4. Run the *same* existing verifier-badge enrichment query (the
   `accountVerifications` LEFT JOIN `trustedVerifiers`/`orgs`) over the
   **combined, deduped** set — a live-only account can still correctly show a
   "Verified by" badge if it happens to already have a verification row (this
   also directly benefits from Part 2's crawler fix).
5. Each result carries an `indexed: boolean` field (true if it came from/matches
   the local `accounts` table, false if live-only). `AccountCard` renders a
   "Not yet indexed" badge (same visual pattern as the existing "custom domain"
   badge) when `indexed === false`.

### Acting on live-only results

Verify and Add-to-backlog already work on non-indexed accounts (verified
identity resolution already falls back to a live profile fetch when an account
isn't in `accounts`, built earlier for spoof-protection). New: when a result
carrying `indexed: false` is verified or backlogged, it is **upserted into
`accounts`** at that point (reusing the existing `toAccountRow`/
`hydrateAccounts`-style upsert shape from the crawler) — so it shows up
correctly, badges and all, in the very next local search, not only after some
future crawl. Already-indexed results (`indexed: true`) are unaffected — no
redundant write is triggered for them.

---

## Part 2: Self-Verification Crawl Fix

### Problem

`crawlVerifications` only re-reads verification records from DIDs sourced from
`syncTrustedVerifiers()` — which itself only resolves DIDs from the *external*
Mu trusted-verifier list (`TRUSTED_VERIFIER_LIST_URIS`). An onboarded org's own
self-verifications (writes made through Vidi's own "Verify selected" action) are
structurally invisible to the crawler unless that org's DID also happens to be
on Mu's external list. Since `TRUSTED_VERIFIER_LIST_URIS` is currently unset,
**no self-verifications are ever rediscovered by a crawl**, even though the
underlying atproto records are completely real and correct (visible on Mu's own
UI). This was confirmed live: a July 6 self-verification never appeared with a
badge in production search, because production's crawler had no path to it.

### Fix

An onboarded org *is* a trusted verifier by definition (that's the entire
premise of the allowlist gate) — its self-verifications should always be
crawled, independent of whether Mu's external list is configured. In
`src/crawler/run.ts`, before calling `crawlVerifications`, merge in every DID
from the `orgs` table alongside whatever `syncTrustedVerifiers()` returns
(deduped). No change needed to the search route's name-resolution — it already
falls back to `orgs.handle` when a verifier isn't in the `trustedVerifiers`
cache (built in an earlier fix this session), so a self-verifier's badge
correctly shows the org's own handle without further changes.

### Verification plan

Since `run.ts` is orchestration-only (established precedent from its original
build: no dedicated unit test for the top-level orchestration, just must
compile cleanly and be verified live), this fix is verified the same way:
run the crawler locally and in production after the fix ships, and confirm
Devoxx Belgium / Volt Belgium (both already genuinely verified on-chain) pick
up their "Verified by" badge on the next crawl.

---

## Testing (both parts)

- Unit test for the live-search-merge logic (dedup by DID, `indexed` flag
  assignment, local-version-wins-on-conflict).
- Unit test for the extracted shared public-agent helper (used by both
  `verifyService.ts` and the new live-search code).
- Route test: `liveNetwork: true` triggers the live call only when text is
  present, merges results, and runs enrichment over the combined set.
- UI test: the two graph-dependent filter controls disable and clear when the
  live-network checkbox is checked.
- Crawler: verified live (per precedent), not unit-tested at the orchestration
  level.

## Out of scope / YAGNI

- No pagination/infinite-scroll on live results (single 25-result page).
- No caching of live search responses.
- No change to how "followed by a verified account" or TV-list crawling work —
  only the *verifier DID list fed into* `crawlVerifications` changes.
