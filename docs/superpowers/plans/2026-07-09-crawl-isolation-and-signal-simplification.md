# Crawl Isolation & Signal Simplification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop the crawl from crashing the web server and delete the unbounded follows-discovery phase (and the brittle followers/following signals) that caused the OOM.

**Architecture:** The manual "Run crawl now" trigger stops running `runCrawl()` in the Next.js app process; it enqueues a `crawl_requests` row that the existing out-of-process `worker` container claims and runs. The entire "followed by a verified account / verified by" filter feature — including the unbounded `collectFollowedByVerified` phase and the `account_signals` table — is removed. `followers_count`/`follows_count` columns are dropped. Per-verifier checkmarks (from `account_verifications`) and the "Active within" filter (from `last_active_at`) are untouched.

**Tech Stack:** Next.js App Router, Drizzle ORM/PostgreSQL, node-cron, Vitest, shadcn/ui on @base-ui/react.

## Global Constraints

- Never import or call `runCrawl` from anything under `src/app/` — the web process must not run the crawl.
- Keep the verifications crawl (`crawlVerifications`), `account_verifications`, `trusted_verifiers`/`syncTrustedVerifiers`, the per-verifier card checkmarks, and the `excludeVerifiedByUs` + `activeWithinDays` search filters fully intact.
- Keep `last_active_at` / `refreshLastActive` intact.
- The migration is generated with `DATABASE_URL='postgres://x' npx drizzle-kit generate` (no live DB needed — it diffs `schema.ts` against `drizzle/meta/`).
- TDD: write the failing test, confirm red, implement, confirm green. `npm test` and `npx tsc --noEmit` must be clean at the end of every task.
- Frequent commits — one per task, using Conventional Commits, ending with the `Co-Authored-By: Claude Opus 4.8` trailer.

---

### Task 1: Remove the follows-crawl phase from the crawler

**Files:**
- Modify: `src/crawler/run.ts`
- Delete: `src/crawler/followsCrawl.ts`
- Delete: `tests/crawler/followsCrawl.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `runCrawl()` no longer imports `collectFollowedByVerified` or writes `accountSignals`. `seedDids`/`followedMap` are gone. The `stats` object drops nothing it still can compute (`verifiers`, `edges`, `discovered`).

- [ ] **Step 1: Delete the follows-crawl module and its test**

```bash
git rm src/crawler/followsCrawl.ts tests/crawler/followsCrawl.test.ts
```

- [ ] **Step 2: Run the crawler test suite to confirm nothing else imports the deleted module**

Run: `npx vitest run tests/crawler/`
Expected: PASS for the remaining crawler tests. If any test file other than the deleted one imports `followsCrawl`, that is a red flag — stop and report.

- [ ] **Step 3: Edit `src/crawler/run.ts`**

Remove the import line:
```ts
import { collectFollowedByVerified } from './followsCrawl'
```
Remove the `accountSignals` import — change:
```ts
import { accountSignals, crawlRuns, orgs } from '../db/schema'
```
to:
```ts
import { crawlRuns, orgs } from '../db/schema'
```

Replace this block (the follows-crawl phase):
```ts
  const verifiedSubjects = [...new Set(edges.map((e) => e.subjectDid))]
  const seedDids = [...new Set([...verifierDids, ...verifiedSubjects])]

  const followedMap = new Map<string, string[]>()
  for (const seedDid of seedDids) {
    try {
      const partial = await collectFollowedByVerified(agent, [seedDid])
      for (const [did, followers] of partial) {
        const arr = followedMap.get(did) ?? []
        for (const f of followers) if (!arr.includes(f)) arr.push(f)
        followedMap.set(did, arr)
      }
    } catch (err) {
      console.error(`runCrawl: collectFollowedByVerified failed for ${seedDid}`, err)
    }
  }

  let keywordDids: string[] = []
```
with:
```ts
  const verifiedSubjects = [...new Set(edges.map((e) => e.subjectDid))]

  let keywordDids: string[] = []
```

Replace this line (the `allDids` computation, which referenced `followedMap`):
```ts
  const allDids = [...new Set([...verifiedSubjects, ...followedMap.keys(), ...keywordDids])]
```
with:
```ts
  const allDids = [...new Set([...verifiedSubjects, ...keywordDids])]
```

Remove this block (the `accountSignals` write loop) entirely:
```ts
  for (const [did, verifiedFollowers] of followedMap) {
    try {
      await db.insert(accountSignals).values({ subjectDid: did, followedByVerified: true, verifiedFollowers })
        .onConflictDoUpdate({ target: accountSignals.subjectDid, set: { followedByVerified: true, verifiedFollowers } })
    } catch (err) {
      console.error(`runCrawl: failed to write accountSignals for ${did}`, err)
    }
  }

```

Leave `syncTrustedVerifiers`, `crawlVerifications`, `runKeywordSeed`, `hydrateAccounts`, `refreshLastActive`, and the `crawlRuns` insert/update untouched. (`db` is still imported and used by the `crawlRuns`/`orgs` queries.)

- [ ] **Step 4: Verify tsc and the crawler suite**

Run: `npx tsc --noEmit && npx vitest run tests/crawler/`
Expected: tsc clean; crawler tests pass.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "refactor(crawler): remove unbounded follows-discovery phase

The collectFollowedByVerified phase seeded getFollows with verifiers plus
every verified subject (~6.7k DIDs), accumulating into one in-memory map for
the whole run — the source of the production OOM. Removed with its account_signals
writes; verification-record crawling (card checkmarks) is unaffected.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: Remove the follows/verified-by conditions from the query builder

**Files:**
- Modify: `src/lib/search/queryBuilder.ts`
- Test: `tests/lib/queryBuilder.test.ts`

**Interfaces:**
- Consumes: `accounts`, `accountVerifications` (unchanged).
- Produces: `SearchFilters` no longer has `verifiedByAnyOf` or `followedByVerified`. `buildConditions` no longer emits those two conditions and no longer imports `accountSignals`. `customDomainOnly`, `text`, `activeWithinDays`, `excludeVerifiedByUs` are unchanged.

- [ ] **Step 1: Read the current test file**

Run: `cat tests/lib/queryBuilder.test.ts` to see which cases reference `followedByVerified`/`verifiedByAnyOf`.

- [ ] **Step 2: Update the tests (write the new expectations first)**

In `tests/lib/queryBuilder.test.ts`, delete any `it(...)` case whose filter input sets `followedByVerified` or `verifiedByAnyOf`, and remove those keys from any shared/combined-filter case. If a combined-filter case asserted a specific condition count (e.g. `expect(conds).toHaveLength(3)`), recompute the expected count for the remaining filters it sets and update the number. Do not add new behavior — only remove the two dropped filters.

- [ ] **Step 3: Run the tests to confirm they fail**

Run: `npx vitest run tests/lib/queryBuilder.test.ts`
Expected: FAIL — the tests now reference a `SearchFilters` shape and `buildConditions` behavior that still emits the old conditions / compiles the old keys (type errors or count mismatches).

- [ ] **Step 4: Edit `src/lib/search/queryBuilder.ts`**

Change the import:
```ts
import { and, or, ilike, eq, inArray, exists, notExists, gte, type SQL } from 'drizzle-orm'
import { db } from '../../db/client'
import { accounts, accountVerifications, accountSignals } from '../../db/schema'
```
to:
```ts
import { and, or, ilike, eq, exists, notExists, gte, type SQL } from 'drizzle-orm'
import { db } from '../../db/client'
import { accounts, accountVerifications } from '../../db/schema'
```
(`inArray` was only used by the removed `verifiedByAnyOf` branch; `accountSignals` only by the removed `followedByVerified` branch.)

Change the type:
```ts
export type SearchFilters = {
  text?: string
  customDomainOnly?: boolean
  verifiedByAnyOf?: string[]
  followedByVerified?: boolean
  activeWithinDays?: number | null
  excludeVerifiedByUs?: boolean
}
```
to:
```ts
export type SearchFilters = {
  text?: string
  customDomainOnly?: boolean
  activeWithinDays?: number | null
  excludeVerifiedByUs?: boolean
}
```

Delete these two blocks from `buildConditions`:
```ts
  if (f.verifiedByAnyOf && f.verifiedByAnyOf.length) {
    conds.push(exists(
      db.select().from(accountVerifications).where(and(
        eq(accountVerifications.subjectDid, accounts.did),
        inArray(accountVerifications.verifierDid, f.verifiedByAnyOf),
      )),
    ))
  }
  if (f.followedByVerified) {
    conds.push(exists(
      db.select().from(accountSignals).where(and(
        eq(accountSignals.subjectDid, accounts.did),
        eq(accountSignals.followedByVerified, true),
      )),
    ))
  }
```

Leave the `text`, `customDomainOnly`, `activeWithinDays` (with its explanatory comment), and `excludeVerifiedByUs` branches and `searchAccounts` untouched. Note `exists` is still used by no remaining branch after this edit — wait: `excludeVerifiedByUs` uses `notExists`, and no branch uses `exists` anymore. Remove `exists` from the import too if and only if `npx tsc --noEmit` reports it unused; keep `notExists`. (Confirm by compiling.)

- [ ] **Step 5: Run the tests to confirm they pass**

Run: `npx vitest run tests/lib/queryBuilder.test.ts && npx tsc --noEmit`
Expected: PASS; tsc clean (fix the `exists` import per Step 4 if tsc flags it).

- [ ] **Step 6: Commit**

```bash
git add src/lib/search/queryBuilder.ts tests/lib/queryBuilder.test.ts
git commit -m "refactor(search): drop followed-by-verified and verified-by filter conditions

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: Remove the filter UI from SearchForm and the search page

**Files:**
- Modify: `src/components/SearchForm.tsx`
- Modify: `src/app/(app)/search/page.tsx`
- Test: `tests/ui/searchForm.test.tsx`

**Interfaces:**
- Consumes: `ACTIVITY_BUCKETS` (unchanged), the `SearchFilters` type from Task 2.
- Produces: `SearchForm` no longer accepts a `trustedVerifiers` prop; its `onSearch` payload drops `followedByVerified` and `verifiedByAnyOf`. `SearchPage` no longer fetches `/api/trusted-verifiers` or holds `tvs`.

- [ ] **Step 1: Rewrite `tests/ui/searchForm.test.tsx`**

Replace the entire file with (all `trustedVerifiers`-dependent cases removed; the scope/activity/exclude cases kept, with the `trustedVerifiers` prop removed from every render):
```tsx
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { SearchForm } from '../../src/components/SearchForm'

// SearchForm uses fixed element ids, so multiple renders left mounted across
// tests in this file collide. Clean up after each test to keep renders isolated.
afterEach(cleanup)

describe('SearchForm', () => {
  it('renders the primary search field, filter controls, and the search-scope toggle', () => {
    render(<SearchForm onSearch={vi.fn()} />)
    expect(screen.getByLabelText(/search in bio or handle/i)).toBeTruthy()
    expect(screen.getByRole('checkbox', { name: /only domain handles/i })).toBeTruthy()
    expect(screen.getByRole('checkbox', { name: /hide accounts already verified by us/i })).toBeTruthy()
    expect(screen.getByRole('button', { name: /harvested accounts/i })).toBeTruthy()
    expect(screen.getByRole('button', { name: /^live network$/i })).toBeTruthy()
  })

  it('no longer renders the followed-by-verified or verified-by controls', () => {
    render(<SearchForm onSearch={vi.fn()} />)
    expect(screen.queryByRole('checkbox', { name: /followed by a verified account/i })).toBeNull()
    expect(screen.queryByText(/^verified by$/i)).toBeNull()
  })

  it('reflects the selected scope via aria-pressed on the toggle buttons', () => {
    render(<SearchForm onSearch={vi.fn()} />)
    const harvested = screen.getByRole('button', { name: /harvested accounts/i })
    const live = screen.getByRole('button', { name: /^live network$/i })
    expect(harvested.getAttribute('aria-pressed')).toBe('true')
    expect(live.getAttribute('aria-pressed')).toBe('false')

    fireEvent.click(live)

    expect(harvested.getAttribute('aria-pressed')).toBe('false')
    expect(live.getAttribute('aria-pressed')).toBe('true')
  })

  it('defaults "Hide accounts already verified by us" to checked', () => {
    render(<SearchForm onSearch={vi.fn()} />)
    const checkbox = screen.getByRole('checkbox', { name: /hide accounts already verified by us/i })
    expect(checkbox.getAttribute('aria-checked')).toBe('true')
  })

  it('includes excludeVerifiedByUs and activeWithinDays in the submitted filters', () => {
    const onSearch = vi.fn()
    render(<SearchForm onSearch={onSearch} />)
    fireEvent.click(screen.getByRole('button', { name: /^search$/i }))
    expect(onSearch).toHaveBeenCalledWith(
      expect.objectContaining({ excludeVerifiedByUs: true, activeWithinDays: null })
    )
  })

  it('does not include followedByVerified or verifiedByAnyOf in the submitted filters', () => {
    const onSearch = vi.fn()
    render(<SearchForm onSearch={onSearch} />)
    fireEvent.click(screen.getByRole('button', { name: /^search$/i }))
    const payload = onSearch.mock.calls[0][0]
    expect(payload).not.toHaveProperty('followedByVerified')
    expect(payload).not.toHaveProperty('verifiedByAnyOf')
  })

  it('selects an activity bucket and includes it in submitted filters', () => {
    const onSearch = vi.fn()
    render(<SearchForm onSearch={onSearch} />)
    fireEvent.click(screen.getByRole('button', { name: /^1 month$/i }))
    fireEvent.click(screen.getByRole('button', { name: /^search$/i }))
    expect(onSearch).toHaveBeenCalledWith(expect.objectContaining({ activeWithinDays: 30 }))
  })

  it('disables and clears the activity-timeframe control when the live network scope is selected', () => {
    render(<SearchForm onSearch={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: /^1 month$/i }))
    fireEvent.click(screen.getByRole('button', { name: /^live network$/i }))

    const oneMonth = screen.getByRole('button', { name: /^1 month$/i }) as HTMLButtonElement
    expect(oneMonth.getAttribute('aria-pressed')).toBe('false')
    // A plain (non-composite) Button's `disabled` prop renders the native
    // `disabled` attribute, not `aria-disabled`.
    expect(oneMonth.disabled).toBe(true)
    const anyTime = screen.getByRole('button', { name: /^any time$/i })
    expect(anyTime.getAttribute('aria-pressed')).toBe('true')
  })

  it('re-enables the activity control when switching back to harvested accounts', () => {
    render(<SearchForm onSearch={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: /^live network$/i }))
    fireEvent.click(screen.getByRole('button', { name: /harvested accounts/i }))
    const oneMonth = screen.getByRole('button', { name: /^1 month$/i }) as HTMLButtonElement
    expect(oneMonth.disabled).toBe(false)
  })
})
```

- [ ] **Step 2: Run to confirm failure**

Run: `npx vitest run tests/ui/searchForm.test.tsx`
Expected: FAIL — `SearchForm` still requires the `trustedVerifiers` prop and still renders the followed-by-verified checkbox.

- [ ] **Step 3: Edit `src/components/SearchForm.tsx`**

Replace the entire file with:
```tsx
'use client'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ACTIVITY_BUCKETS } from '@/lib/activityBuckets'

export type SearchFilters = {
  text: string
  customDomainOnly: boolean
  liveNetwork: boolean
  activeWithinDays: number | null
  excludeVerifiedByUs: boolean
}

export function SearchForm({ onSearch }: { onSearch: (filters: SearchFilters) => void }) {
  const [text, setText] = useState('')
  const [customDomainOnly, setCustomDomainOnly] = useState(false)
  const [liveNetwork, setLiveNetwork] = useState(false)
  const [activeWithinDays, setActiveWithinDays] = useState<number | null>(null)
  const [excludeVerifiedByUs, setExcludeVerifiedByUs] = useState(true)

  function setScope(live: boolean) {
    setLiveNetwork(live)
    if (live) setActiveWithinDays(null)
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Search</CardTitle>
      </CardHeader>
      <CardContent>
        <form
          className="flex flex-col gap-5"
          onSubmit={(e) => {
            e.preventDefault()
            onSearch({ text, customDomainOnly, liveNetwork, activeWithinDays, excludeVerifiedByUs })
          }}
        >
          <div className="flex flex-col gap-2">
            <Label htmlFor="search-text">Search in bio or handle</Label>
            <Input id="search-text" value={text} onChange={(e) => setText(e.target.value)} />
          </div>

          <div className="flex flex-col gap-3">
            <p className="text-sm font-medium">Filters</p>
            <Label className="flex items-center gap-2">
              <Checkbox
                id="search-custom-domain"
                checked={customDomainOnly}
                onCheckedChange={(checked) => setCustomDomainOnly(checked === true)}
              />
              Only domain handles (e.g. lalibre.be)
            </Label>
            <Label className="flex items-center gap-2">
              <Checkbox
                id="search-exclude-verified-by-us"
                checked={excludeVerifiedByUs}
                onCheckedChange={(checked) => setExcludeVerifiedByUs(checked === true)}
              />
              Hide accounts already verified by us
            </Label>
          </div>

          <div className="flex flex-col gap-2">
            <Label>Active within</Label>
            <div role="group" aria-label="Activity timeframe" className="inline-flex w-fit flex-wrap gap-1 rounded-lg border border-border p-1">
              {ACTIVITY_BUCKETS.map((b) => (
                <Button
                  key={b.days}
                  type="button"
                  size="sm"
                  variant={activeWithinDays === b.days ? 'default' : 'ghost'}
                  aria-pressed={activeWithinDays === b.days}
                  disabled={liveNetwork}
                  onClick={() => setActiveWithinDays(b.days)}
                >
                  {b.label}
                </Button>
              ))}
              <Button
                type="button"
                size="sm"
                variant={activeWithinDays === null ? 'default' : 'ghost'}
                aria-pressed={activeWithinDays === null}
                disabled={liveNetwork}
                onClick={() => setActiveWithinDays(null)}
              >
                Any time
              </Button>
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <Label>Search in</Label>
            <div role="group" aria-label="Search scope" className="inline-flex w-fit gap-1 rounded-lg border border-border p-1">
              <Button
                type="button"
                size="sm"
                variant={liveNetwork ? 'ghost' : 'default'}
                aria-pressed={!liveNetwork}
                onClick={() => setScope(false)}
              >
                Harvested accounts
              </Button>
              <Button
                type="button"
                size="sm"
                variant={liveNetwork ? 'default' : 'ghost'}
                aria-pressed={liveNetwork}
                onClick={() => setScope(true)}
              >
                Live network
              </Button>
            </div>
            {liveNetwork && (
              <p className="text-xs text-muted-foreground">
                Requires text above. Only matches text/domain.
              </p>
            )}
          </div>

          <Button type="submit" className="self-start">
            Search
          </Button>
        </form>
      </CardContent>
    </Card>
  )
}
```

- [ ] **Step 4: Edit `src/app/(app)/search/page.tsx`**

Remove the `TV` type (`type TV = { did: string; handle: string }`).

Remove the `tvs` state line:
```ts
  const [tvs, setTvs] = useState<TV[]>([])
```

Remove the trusted-verifiers fetch effect entirely:
```ts
  useEffect(() => {
    fetch('/vidi/api/trusted-verifiers')
      .then((r) => r.json())
      .then((d) => setTvs(d.verifiers ?? []))
      .catch(() => {})
  }, [])
```

Change the form render:
```tsx
      <SearchForm trustedVerifiers={tvs} onSearch={search} />
```
to:
```tsx
      <SearchForm onSearch={search} />
```

If `useEffect` is now unused, remove it from the React import (`import { useEffect, useState } from 'react'` → `import { useState } from 'react'`). Confirm by compiling.

- [ ] **Step 5: Run tests + full suite + tsc**

Run: `npx vitest run tests/ui/searchForm.test.tsx tests/ui/searchPageVerify.test.tsx && npx tsc --noEmit`
Expected: PASS; tsc clean. (`searchPageVerify.test.tsx` mocks `SearchForm`, so it is unaffected; its dead `/trusted-verifiers` fetch mock branch is harmless — leave it.)

- [ ] **Step 6: Commit**

```bash
git add src/components/SearchForm.tsx "src/app/(app)/search/page.tsx" tests/ui/searchForm.test.tsx
git commit -m "refactor(search): remove followed-by-verified / verified-by filter UI

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: Drop followers/following from write paths, UI, and tests

**Files:**
- Modify: `src/crawler/hydrate.ts`
- Modify: `src/lib/verify/verifyService.ts`
- Modify: `src/app/api/backlog/route.ts`
- Modify: `src/components/AccountCard.tsx`
- Modify: `src/app/(app)/search/page.tsx`
- Test: `tests/crawler/hydrate.test.ts`, `tests/lib/verifyService.test.ts`, `tests/api/backlog.test.ts`, `tests/ui/accountCard.test.tsx`

**Interfaces:**
- Consumes: nothing new.
- Produces: `AccountRow` (in `hydrate.ts`) drops `followersCount`/`followsCount`; all upsert call sites stop passing them; `AccountCard`'s `Account` type and signals line drop them. (The `accounts` schema columns are dropped later in Task 7.)

- [ ] **Step 1: Update the tests first**

In each of the four test files, remove every assertion and every mock/fixture field named `followersCount` or `followsCount`:
- `tests/crawler/hydrate.test.ts`: drop those keys from expected upsert-row objects and from any `ProfileViewDetailed` fixture; drop any `expect(...).toMatchObject({ followersCount... })`-style assertions.
- `tests/lib/verifyService.test.ts`: same — remove them from profile fixtures and upsert-row expectations.
- `tests/api/backlog.test.ts`: remove `followersCount`/`followsCount` from `backlogRows` fixtures and from the `toMatchObject` expectation in the GET-enrichment describe block.
- `tests/ui/accountCard.test.tsx`: remove the follower/following-count fixtures and any test asserting the `following`/`followers` text (including the null-vs-zero `'—'` tests added in commit 7a89e01). Keep tests covering the handle, verifier checkmarks, `describeLastActive`, and the not-yet-indexed badge.

- [ ] **Step 2: Run to confirm failure**

Run: `npx vitest run tests/crawler/hydrate.test.ts tests/lib/verifyService.test.ts tests/api/backlog.test.ts tests/ui/accountCard.test.tsx`
Expected: FAIL (or type errors) — the source still emits these fields / the `Account` type still declares them.

- [ ] **Step 3: Edit `src/crawler/hydrate.ts`**

In the `AccountRow` type, remove:
```ts
  followersCount: number | null
  followsCount: number | null
```
In `toAccountRow`, remove:
```ts
    followersCount: p.followersCount ?? null,
    followsCount: p.followsCount ?? null,
```
In `upsertAccountRow`'s `onConflictDoUpdate` `set`, remove:
```ts
        followersCount: row.followersCount,
        followsCount: row.followsCount,
```

- [ ] **Step 4: Edit `src/lib/verify/verifyService.ts`**

In the `upsertAccountRow({...})` call inside `resolveSubjectIdentity`, remove:
```ts
      followersCount: prof.data.followersCount ?? null,
      followsCount: prof.data.followsCount ?? null,
```

- [ ] **Step 5: Edit `src/app/api/backlog/route.ts`**

In the GET `.select({...})`, remove:
```ts
        followersCount: accounts.followersCount,
        followsCount: accounts.followsCount,
```
In the POST `upsertAccountRow({...})` call, remove:
```ts
            followersCount: prof.data.followersCount ?? null,
            followsCount: prof.data.followsCount ?? null,
```

- [ ] **Step 6: Edit `src/components/AccountCard.tsx`**

In the `Account` type, remove:
```ts
  followersCount?: number | null
  followsCount?: number | null
```
Replace the signals paragraph:
```tsx
          {showSignals && (
            <p className="text-xs text-muted-foreground">
              {acc.followsCount ?? '—'} following · {acc.followersCount ?? '—'} followers ·{' '}
              {describeLastActive(acc.lastActiveAt)}
            </p>
          )}
```
with:
```tsx
          {showSignals && (
            <p className="text-xs text-muted-foreground">{describeLastActive(acc.lastActiveAt)}</p>
          )}
```

- [ ] **Step 7: Edit `src/app/(app)/search/page.tsx`**

In the `Account` type, remove:
```ts
  followersCount?: number | null
  followsCount?: number | null
```

- [ ] **Step 8: Run the tests + full suite + tsc**

Run: `npx tsc --noEmit && npm test`
Expected: tsc clean; all tests pass.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "refactor: drop followers/following signal from write paths and UI

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 5: Enqueue crawl requests instead of running in the web process

**Files:**
- Modify: `src/db/schema.ts` (add `crawlRequests` table only — column/table drops happen in Task 7)
- Modify: `src/app/api/crawl/run/route.ts`
- Test: `tests/api/crawlRun.test.ts` (new)

**Interfaces:**
- Consumes: `getActor`, `assertOwner`/`AuthzError` (unchanged), `db`.
- Produces: `crawlRequests` table (`id`, `requestedByDid`, `requestedAt`, `claimedAt`) exported from `db/schema.ts` for Task 6 to consume. `POST /api/crawl/run` inserts a row and returns `{ ok: true, queued: true }`; it no longer imports `runCrawl`.

- [ ] **Step 1: Add the `crawlRequests` table to `src/db/schema.ts`**

After the `crawlSeeds` table definition, add:
```ts
export const crawlRequests = pgTable('crawl_requests', {
  id: serial('id').primaryKey(),
  requestedByDid: text('requested_by_did'),
  requestedAt: timestamp('requested_at', { withTimezone: true }).defaultNow(),
  claimedAt: timestamp('claimed_at', { withTimezone: true }), // null = pending
})
```
(`pgTable`, `serial`, `text`, `timestamp` are already imported.)

- [ ] **Step 2: Write the failing route test**

Create `tests/api/crawlRun.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../src/lib/authz/session', () => ({ getActor: async () => ({ did: 'did:plc:owner' }) }))
vi.mock('../../src/lib/authz/membership', () => ({
  assertOwner: async () => {},
  AuthzError: class extends Error {
    status = 403
  },
}))

vi.mock('../../src/db/schema', () => ({
  crawlRequests: { __t: 'crawlRequests' } as any,
}))

const insertedInto: string[] = []
const insertedValues: Record<string, unknown>[] = []
vi.mock('../../src/db/client', () => ({
  db: {
    insert: (table: any) => {
      insertedInto.push(table?.__t)
      return {
        values: async (values: Record<string, unknown>) => {
          insertedValues.push(values)
        },
      }
    },
  },
}))

// A guard: if the route ever imports runCrawl, this mock records that it was
// called — the test asserts it is NEVER called (the whole point of the change).
const runCrawl = vi.fn()
vi.mock('../../src/crawler/run', () => ({ runCrawl: () => runCrawl() }))

import { POST } from '../../src/app/api/crawl/run/route'

function makeReq(body: unknown) {
  return { json: async () => body } as any
}

beforeEach(() => {
  insertedInto.length = 0
  insertedValues.length = 0
  runCrawl.mockReset()
})

describe('POST /api/crawl/run', () => {
  it('enqueues a crawl_requests row and does not run the crawl in-process', async () => {
    const res = await POST(makeReq({ orgId: 1 }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toMatchObject({ ok: true, queued: true })
    expect(insertedInto).toEqual(['crawlRequests'])
    expect(insertedValues[0]).toMatchObject({ requestedByDid: 'did:plc:owner' })
    expect(runCrawl).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 3: Run to confirm failure**

Run: `npx vitest run tests/api/crawlRun.test.ts`
Expected: FAIL — the current route calls `runCrawl()` and returns `{ ok: true, started: true }`, not an enqueue.

- [ ] **Step 4: Rewrite `src/app/api/crawl/run/route.ts`**

Replace the entire file with:
```ts
import { NextRequest, NextResponse } from 'next/server'
import { getActor } from '../../../../lib/authz/session'
import { assertOwner, AuthzError } from '../../../../lib/authz/membership'
import { db } from '../../../../db/client'
import { crawlRequests } from '../../../../db/schema'

function guard<T>(fn: () => Promise<T>) {
  return fn().catch((e) => {
    if (e instanceof AuthzError) return NextResponse.json({ error: e.message }, { status: e.status })
    throw e
  })
}

export async function POST(req: NextRequest) {
  return guard(async () => {
    const actor = await getActor(); if (!actor) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })
    const { orgId } = await req.json()
    await assertOwner(actor.did, orgId)
    // The crawl must NOT run in the web-server process (a crash there takes the
    // whole site down). Enqueue a request; the out-of-process `worker` container
    // (src/crawler/scheduler.ts) claims and runs it.
    await db.insert(crawlRequests).values({ requestedByDid: actor.did })
    return NextResponse.json({ ok: true, queued: true })
  })
}
```

- [ ] **Step 5: Run the test + tsc**

Run: `npx vitest run tests/api/crawlRun.test.ts && npx tsc --noEmit`
Expected: PASS; tsc clean.

- [ ] **Step 6: Commit**

```bash
git add src/db/schema.ts src/app/api/crawl/run/route.ts tests/api/crawlRun.test.ts
git commit -m "feat(crawl): enqueue crawl requests instead of running in the web process

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 6: Worker claims and runs enqueued crawl requests (with overlap guard)

**Files:**
- Create: `src/crawler/scheduler.ts` (rewrite) and `src/crawler/crawlRunner.ts` (new, testable core)
- Test: `tests/crawler/crawlRunner.test.ts` (new)

**Interfaces:**
- Consumes: `runCrawl` from `./run`, `crawlRequests` from `../db/schema`, `db`.
- Produces: `crawlRunner.ts` exports `makeCrawlRunner({ runCrawl, claimNextRequest })` returning `{ runCrawlGuarded, pollOnce }`, so the guard/claim logic is unit-testable without node-cron or a live DB. `scheduler.ts` wires the real `runCrawl` + a DB-backed `claimNextRequest`, the cron schedule, and the poll interval.

**Why split:** `scheduler.ts` runs side effects at import time (cron + setInterval), which is awkward to unit-test. Extracting the pure logic into `crawlRunner.ts` lets us test the guard and claim behavior directly.

- [ ] **Step 1: Write the failing test**

Create `tests/crawler/crawlRunner.test.ts`:
```ts
import { describe, it, expect, vi } from 'vitest'
import { makeCrawlRunner } from '../../src/crawler/crawlRunner'

describe('makeCrawlRunner', () => {
  it('runs the crawl when idle and clears the running flag afterward', async () => {
    const runCrawl = vi.fn().mockResolvedValue(undefined)
    const { runCrawlGuarded } = makeCrawlRunner({ runCrawl, claimNextRequest: vi.fn() })
    await runCrawlGuarded()
    expect(runCrawl).toHaveBeenCalledTimes(1)
    // A second call after the first resolves runs again (flag was cleared).
    await runCrawlGuarded()
    expect(runCrawl).toHaveBeenCalledTimes(2)
  })

  it('skips a concurrent run while one is already in progress', async () => {
    let release: () => void = () => {}
    const runCrawl = vi.fn().mockImplementation(() => new Promise<void>((r) => { release = r }))
    const { runCrawlGuarded } = makeCrawlRunner({ runCrawl, claimNextRequest: vi.fn() })
    const first = runCrawlGuarded()   // starts, holds the flag
    await runCrawlGuarded()           // should be skipped (still running)
    expect(runCrawl).toHaveBeenCalledTimes(1)
    release()
    await first
  })

  it('clears the running flag even if the crawl throws', async () => {
    const runCrawl = vi.fn()
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce(undefined)
    const { runCrawlGuarded } = makeCrawlRunner({ runCrawl, claimNextRequest: vi.fn() })
    await runCrawlGuarded()           // throws internally, must not leak the flag
    await runCrawlGuarded()
    expect(runCrawl).toHaveBeenCalledTimes(2)
  })

  it('pollOnce runs the crawl when a request is claimed', async () => {
    const runCrawl = vi.fn().mockResolvedValue(undefined)
    const claimNextRequest = vi.fn().mockResolvedValue(true)
    const { pollOnce } = makeCrawlRunner({ runCrawl, claimNextRequest })
    await pollOnce()
    expect(claimNextRequest).toHaveBeenCalledTimes(1)
    expect(runCrawl).toHaveBeenCalledTimes(1)
  })

  it('pollOnce does nothing when no request is pending', async () => {
    const runCrawl = vi.fn().mockResolvedValue(undefined)
    const claimNextRequest = vi.fn().mockResolvedValue(false)
    const { pollOnce } = makeCrawlRunner({ runCrawl, claimNextRequest })
    await pollOnce()
    expect(runCrawl).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run to confirm failure**

Run: `npx vitest run tests/crawler/crawlRunner.test.ts`
Expected: FAIL — `src/crawler/crawlRunner.ts` does not exist.

- [ ] **Step 3: Implement `src/crawler/crawlRunner.ts`**

```ts
/**
 * Pure crawl-run orchestration, decoupled from node-cron and the DB so it can
 * be unit-tested. `runCrawlGuarded` ensures the crawl never runs twice
 * concurrently in this process (cron and the manual-request poll share the
 * guard). `pollOnce` claims one pending request and, if it got one, runs.
 */
export function makeCrawlRunner(deps: {
  runCrawl: () => Promise<void>
  claimNextRequest: () => Promise<boolean>
}) {
  let running = false

  async function runCrawlGuarded(): Promise<void> {
    if (running) {
      console.log('crawlRunner: skipping — a crawl is already running')
      return
    }
    running = true
    try {
      await deps.runCrawl()
    } catch (err) {
      console.error('crawlRunner: crawl failed', err)
    } finally {
      running = false
    }
  }

  async function pollOnce(): Promise<void> {
    let claimed = false
    try {
      claimed = await deps.claimNextRequest()
    } catch (err) {
      console.error('crawlRunner: failed to claim a crawl request', err)
      return
    }
    if (claimed) await runCrawlGuarded()
  }

  return { runCrawlGuarded, pollOnce }
}
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `npx vitest run tests/crawler/crawlRunner.test.ts`
Expected: PASS (5/5).

- [ ] **Step 5: Rewrite `src/crawler/scheduler.ts` to wire the real deps**

```ts
import cron from 'node-cron'
import { eq, isNull } from 'drizzle-orm'
import { db } from '../db/client'
import { crawlRequests } from '../db/schema'
import { runCrawl } from './run'
import { makeCrawlRunner } from './crawlRunner'

const expr = process.env.VIDI_CRAWL_CRON ?? '0 3 * * *'
const pollMs = Number(process.env.VIDI_CRAWL_POLL_MS ?? 30_000)

/**
 * Claims the oldest unclaimed crawl request by stamping claimed_at. Returns
 * true if one was claimed. Claiming before the run means a request is consumed
 * even if the subsequent run errors — a failed run must not re-trigger forever.
 * A single worker container runs this, so the non-atomic select-then-update is
 * safe; the claimed_at column additionally makes consumption durable.
 */
async function claimNextRequest(): Promise<boolean> {
  const [pending] = await db
    .select({ id: crawlRequests.id })
    .from(crawlRequests)
    .where(isNull(crawlRequests.claimedAt))
    .orderBy(crawlRequests.id)
    .limit(1)
  if (!pending) return false
  await db.update(crawlRequests).set({ claimedAt: new Date() }).where(eq(crawlRequests.id, pending.id))
  return true
}

const { runCrawlGuarded, pollOnce } = makeCrawlRunner({ runCrawl, claimNextRequest })

cron.schedule(expr, () => { void runCrawlGuarded() })
setInterval(() => { void pollOnce() }, pollMs)

console.log(`vidi crawler scheduled: ${expr}; polling crawl_requests every ${pollMs}ms`)
```

- [ ] **Step 6: Verify tsc + crawler suite**

Run: `npx tsc --noEmit && npx vitest run tests/crawler/`
Expected: tsc clean; crawler tests pass.

- [ ] **Step 7: Commit**

```bash
git add src/crawler/crawlRunner.ts src/crawler/scheduler.ts tests/crawler/crawlRunner.test.ts
git commit -m "feat(crawler): worker claims enqueued crawl requests with an overlap guard

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 7: Drop the dead schema (account_signals + follower columns) and generate the migration

**Files:**
- Modify: `src/db/schema.ts`
- Modify: `tests/integration/smoke.md` (stale manual-checklist cleanup)
- Create: `drizzle/0003_*.sql` (generated) + updated `drizzle/meta/*`

**Interfaces:**
- Consumes: nothing.
- Produces: `account_signals` table, `accounts.followers_count`, and `accounts.follows_count` removed from the schema; a single migration that DROPs them and CREATEs `crawl_requests`.

**Precondition:** Tasks 1–6 are complete, so nothing in `src/` references `accountSignals`, `followersCount`, or `followsCount` any longer. Confirm before editing:

- [ ] **Step 1: Confirm no remaining references**

Run: `grep -rn "accountSignals\|followersCount\|followsCount" src/`
Expected: NO matches. If any appear, stop — the referencing task was not fully applied.

- [ ] **Step 2: Edit `src/db/schema.ts`**

Remove the two columns from the `accounts` table:
```ts
  followersCount: integer('followers_count'),
  followsCount: integer('follows_count'),
```
Remove the entire `accountSignals` table definition:
```ts
export const accountSignals = pgTable('account_signals', {
  subjectDid: text('subject_did').primaryKey(),
  followedByVerified: boolean('followed_by_verified').notNull().default(false),
  verifiedFollowers: jsonb('verified_followers').$type<string[]>().default([]),
})
```
If, after this, `integer` or `jsonb` is no longer used anywhere in the file, remove it from the top-of-file import. (`integer` is still used by `orgId`/`members` etc.; `jsonb` is still used by `crawlRuns.stats` — so both likely stay. Confirm by compiling.)

- [ ] **Step 3: Generate the migration**

Run: `DATABASE_URL='postgres://x:x@localhost:5432/x' npx drizzle-kit generate`
Expected: a new `drizzle/0003_*.sql` containing `DROP TABLE "account_signals"`, `ALTER TABLE "accounts" DROP COLUMN "followers_count"`, `ALTER TABLE "accounts" DROP COLUMN "follows_count"`, and `CREATE TABLE "crawl_requests" (...)`, plus updated snapshots under `drizzle/meta/`.

- [ ] **Step 4: Inspect the generated SQL**

Run: `cat drizzle/0003_*.sql`
Confirm it contains exactly the four operations above and nothing unexpected (no drops of `account_verifications`, `trusted_verifiers`, or any kept table). If the generator split `crawl_requests` creation into a separate ordering, that is fine as long as all four operations are present.

- [ ] **Step 5: Update the stale manual smoke checklist**

In `tests/integration/smoke.md`, remove the now-invalid search-filter references: delete the `"verifiedByAnyOf"` and `"followedByVerified"` lines from the example filter JSON bodies, remove any example whose sole purpose was the "followed by verified" filter, and delete the assertion line "Results include only accounts with `followedByVerified = true` in `account_signals` table". Leave the `/api/trusted-verifiers` curl example (that route stays) and everything else intact. This file is a manual checklist — not run by `npm test` — so accuracy is the only goal.

- [ ] **Step 6: Verify tsc + full suite**

Run: `npx tsc --noEmit && npm test`
Expected: tsc clean; all tests pass.

- [ ] **Step 7: Commit**

```bash
git add src/db/schema.ts tests/integration/smoke.md drizzle/
git commit -m "feat(db): drop account_signals and follower columns; add crawl_requests

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Post-implementation verification (after all tasks, before/around deploy)

- `npm test` fully green; `npx tsc --noEmit` clean.
- After deploy, the migration runs via the deploy's `migrate.ts` step.
- Trigger a crawl from Settings → "Run crawl now"; confirm via logs/DB that:
  - the app container does NOT run the crawl and does NOT restart,
  - the `worker` container claims the request and runs `runCrawl`,
  - a `crawl_runs` row gets `finished_at` set (the run completes),
  - `accounts.last_active_at` becomes populated for at least some rows.
