# Live Network Search + Self-Verification Crawl + Settings Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let search optionally reach the live atproto network for text/domain matches, fix the crawler so an org's own self-verifications are always rediscovered, and give owners a UI to manage crawl-seed keywords and trigger a crawl on demand.

**Architecture:** Extend the existing `POST /vidi/api/search` route to optionally merge live `app.bsky.actor.searchActors` results (deduped by DID) with local index results, tagging each with an `indexed` flag; extend `src/crawler/run.ts` to always crawl onboarded orgs' own verification records regardless of Mu's external TV list; add a new owner-only `/settings` page backed by new `crawl-seeds` and `crawl/run` API routes reusing the existing `assertOwner` authz pattern.

**Tech Stack:** Next.js App Router, TypeScript, Drizzle ORM, `@atproto/api`, shadcn/ui, Vitest.

## Global Constraints

- Live search uses `app.bsky.actor.searchActors` (NOT `searchActorsTypeahead`) against the shared public AppView agent (`VIDI_PUBLIC_APPVIEW_URL`, default `https://public.api.bsky.app`).
- Live search applies ONLY to text-in-bio/handle and handle-is-a-domain. "Verified by" and "followed by a verified account" are disabled and cleared client-side when live-network mode is on.
- Live search requires non-empty text; if empty, the live portion is silently skipped (local filters still run).
- Live results capped at 25, single page, no pagination.
- Merging happens server-side inside the existing `POST /vidi/api/search` route — no new search endpoint.
- Verifier-badge enrichment runs over the combined (local + live) result set.
- Verifying or backlogging a result with `indexed: false` upserts it into `accounts` at that point. Results with `indexed: true` are never redundantly upserted by this new logic.
- An onboarded org's own DID is always included in the crawler's verifier-DID list, in addition to whatever `syncTrustedVerifiers()` returns from the external TV list.
- Settings page and its API routes are owner-only: `assertOwner(actorDid, orgId)`, the same pattern already used for invite-helper. The nav link is hidden entirely for non-owners.
- Adding an existing (possibly disabled) keyword re-enables it rather than erroring.
- `POST /vidi/api/crawl/run` is fire-and-forget: responds immediately without awaiting `runCrawl()` to completion.
- All new/modified code passes `npx tsc --noEmit` and the full `npm test` suite (currently 82 tests) before each commit.

---

## File Structure

```
src/lib/atproto/publicAgent.ts       # NEW: shared getPublicAppViewAgent() (extracted from verifyService.ts)
src/lib/search/liveSearch.ts         # NEW: searchActorsLive(text, limit) -> LiveActor[]
src/app/api/search/route.ts          # MODIFY: merge live results, indexed flag, enrich combined set
src/components/SearchForm.tsx        # MODIFY: liveNetwork checkbox, disable/clear graph filters
src/components/AccountCard.tsx       # MODIFY: "Not yet indexed" badge
src/app/(app)/search/page.tsx        # MODIFY: pass indexed-aware fields to backlog for live-only results
src/crawler/hydrate.ts               # MODIFY: extract upsertAccountRow(row), reused by hydrateAccounts
src/lib/verify/verifyService.ts      # MODIFY: import shared publicAgent; upsert accounts on live fallback
src/app/api/backlog/route.ts         # MODIFY: optional profile fields upsert accounts for live-only results
src/crawler/run.ts                   # MODIFY: merge orgs.did into verifier crawl list
src/app/api/crawl-seeds/route.ts     # NEW: GET/POST/PATCH, owner-only
src/app/api/crawl/run/route.ts       # NEW: POST, owner-only, fire-and-forget
src/app/(app)/settings/page.tsx      # NEW: owner-only Settings UI
src/app/(app)/layout.tsx             # MODIFY: Settings nav link, owner-only visibility
```

---

## Task 1: Extract shared public AppView agent

**Files:**
- Create: `src/lib/atproto/publicAgent.ts`
- Modify: `src/lib/verify/verifyService.ts:1-20`
- Test: none new (existing `tests/lib/verifyService.test.ts` already mocks `@atproto/api` at module level, which transparently covers the new file too — verified by running the full suite)

**Interfaces:**
- Produces: `getPublicAppViewAgent(): AtpAgent` — exported from `src/lib/atproto/publicAgent.ts`.

- [ ] **Step 1: Create the shared helper**

`src/lib/atproto/publicAgent.ts`:
```ts
import { AtpAgent } from '@atproto/api'

/**
 * Unauthenticated public AppView agent for app.bsky.* reads.
 *
 * Per the atproto read-vs-write architecture, routing app.bsky.* reads
 * through the OAuth-bound org agent proxies the call through the org's PDS,
 * which for non-bsky.social PDS deployments (e.g. eurosky.social) does not
 * reliably implement the PDS-as-AppView-proxy contract and returns
 * `401 Unauthorized` even though OAuth itself succeeded. The public AppView
 * needs no scope/DPoP and works for any account regardless of which PDS
 * hosts it.
 */
export function getPublicAppViewAgent(): AtpAgent {
  return new AtpAgent({ service: process.env.VIDI_PUBLIC_APPVIEW_URL ?? 'https://public.api.bsky.app' })
}
```

- [ ] **Step 2: Update verifyService.ts to use the shared helper**

In `src/lib/verify/verifyService.ts`, replace:
```ts
import { AtpAgent } from '@atproto/api'
import { and, eq } from 'drizzle-orm'
import { db } from '../../db/client'
import { accountVerifications, accounts, verificationActions } from '../../db/schema'
import { getOrgAgent } from '../atproto/orgAgent'
import { checkGuards } from './guardrails'

type Org = { id: number; did: string }

/**
 * Unauthenticated public AppView agent for app.bsky.* reads.
 *
 * Per the atproto read-vs-write architecture, routing app.bsky.* reads
 * through the OAuth-bound org agent proxies the call through the org's PDS,
 * which for non-bsky.social PDS deployments (e.g. eurosky.social) does not
 * reliably implement the PDS-as-AppView-proxy contract and returns
 * `401 Unauthorized` even though OAuth itself succeeded. The public AppView
 * needs no scope/DPoP and works for any account regardless of which PDS
 * hosts it, so we use it for the getProfile fallback below instead.
 */
function getPublicAppViewAgent(): AtpAgent {
  return new AtpAgent({ service: process.env.VIDI_PUBLIC_APPVIEW_URL ?? 'https://public.api.bsky.app' })
}
```
with:
```ts
import { and, eq } from 'drizzle-orm'
import { db } from '../../db/client'
import { accountVerifications, accounts, verificationActions } from '../../db/schema'
import { getOrgAgent } from '../atproto/orgAgent'
import { getPublicAppViewAgent } from '../atproto/publicAgent'
import { checkGuards } from './guardrails'

type Org = { id: number; did: string }
```
(The rest of the file, which calls `getPublicAppViewAgent()`, is unchanged — only the import source moves.)

- [ ] **Step 3: Run full suite to confirm nothing broke**

Run: `npx tsc --noEmit && npm test`
Expected: tsc clean; all 82 existing tests still pass (the `@atproto/api` mock in `tests/lib/verifyService.test.ts` intercepts at module level regardless of which file constructs `AtpAgent`).

- [ ] **Step 4: Commit**

```bash
git add src/lib/atproto/publicAgent.ts src/lib/verify/verifyService.ts
git commit -m "refactor(atproto): extract shared public AppView agent helper"
```

---

## Task 2: Live search function

**Files:**
- Create: `src/lib/search/liveSearch.ts`
- Test: `tests/lib/liveSearch.test.ts`

**Interfaces:**
- Consumes: `getPublicAppViewAgent()` from Task 1; `isCustomDomain(handle)` from `src/lib/domain/handleClassifier.ts`.
- Produces: `type LiveActor = { did: string; handle: string; displayName: string | null; description: string | null; isCustomDomain: boolean }`; `searchActorsLive(text: string, limit?: number): Promise<LiveActor[]>` (default `limit = 25`).

- [ ] **Step 1: Write the failing test**

`tests/lib/liveSearch.test.ts`:
```ts
import { describe, it, expect, vi } from 'vitest'

const searchActors = vi.fn()
vi.mock('@atproto/api', () => ({
  AtpAgent: class {
    app = { bsky: { actor: { searchActors } } }
  },
}))

import { searchActorsLive } from '../../src/lib/search/liveSearch'

describe('searchActorsLive', () => {
  it('maps actors to LiveActor shape and derives isCustomDomain', async () => {
    searchActors.mockResolvedValue({
      data: {
        actors: [
          { did: 'did:plc:a', handle: 'jan.brussels', displayName: 'Jan', description: 'bio' },
          { did: 'did:plc:b', handle: 'x.bsky.social' },
        ],
      },
    })
    const results = await searchActorsLive('brussels')
    expect(searchActors).toHaveBeenCalledWith({ q: 'brussels', limit: 25 })
    expect(results).toEqual([
      { did: 'did:plc:a', handle: 'jan.brussels', displayName: 'Jan', description: 'bio', isCustomDomain: true },
      { did: 'did:plc:b', handle: 'x.bsky.social', displayName: null, description: null, isCustomDomain: false },
    ])
  })

  it('respects a custom limit', async () => {
    searchActors.mockResolvedValue({ data: { actors: [] } })
    await searchActorsLive('gent', 10)
    expect(searchActors).toHaveBeenCalledWith({ q: 'gent', limit: 10 })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/lib/liveSearch.test.ts`
Expected: FAIL — `src/lib/search/liveSearch.ts` does not exist.

- [ ] **Step 3: Implement**

`src/lib/search/liveSearch.ts`:
```ts
import { getPublicAppViewAgent } from '../atproto/publicAgent'
import { isCustomDomain } from '../domain/handleClassifier'

export type LiveActor = {
  did: string
  handle: string
  displayName: string | null
  description: string | null
  isCustomDomain: boolean
}

export async function searchActorsLive(text: string, limit = 25): Promise<LiveActor[]> {
  const agent = getPublicAppViewAgent()
  const { data } = await agent.app.bsky.actor.searchActors({ q: text, limit })
  return data.actors.map((a) => ({
    did: a.did,
    handle: a.handle,
    displayName: a.displayName ?? null,
    description: a.description ?? null,
    isCustomDomain: isCustomDomain(a.handle),
  }))
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/lib/liveSearch.test.ts`
Expected: PASS (2/2).

- [ ] **Step 5: Commit**

```bash
git add src/lib/search/liveSearch.ts tests/lib/liveSearch.test.ts
git commit -m "feat(search): live actor search against the public AppView"
```

---

## Task 3: Merge live results into the search route

**Files:**
- Modify: `src/app/api/search/route.ts` (full file)
- Test: `tests/api/search.test.ts` (extend)

**Interfaces:**
- Consumes: `searchActorsLive(text, limit)` from Task 2; existing `searchAccounts(filters)`, `Verifier` type, enrichment query.
- Produces: each result in the route's JSON response gains `indexed: boolean`. Request `filters` gains an optional `liveNetwork: boolean` field (read directly off the parsed body, not a new exported type).

- [ ] **Step 1: Write the failing tests**

Extend `tests/api/search.test.ts` — add this mock near the top (alongside the existing `queryBuilder` mock) and these test cases inside the `describe` block:

```ts
// Add near the top, after the searchAccounts mock:
const liveActorsResult: unknown[] = []
vi.mock('../../src/lib/search/liveSearch', () => ({
  searchActorsLive: async (...args: unknown[]) => {
    liveSearchCalls.push(args)
    return liveActorsResult
  },
}))
const liveSearchCalls: unknown[][] = []
```

Add these tests inside `describe('search route', ...)`:
```ts
  it('does not call live search when liveNetwork is false', async () => {
    liveSearchCalls.length = 0
    vi.doMock('../../src/lib/authz/session', () => ({ getActor }))
    const { POST } = await import('../../src/app/api/search/route')
    const req = new Request('http://x/vidi/api/search', {
      method: 'POST',
      body: JSON.stringify({ orgId: 1, filters: { text: 'namur', liveNetwork: false } }),
    })
    await POST(req as any)
    expect(liveSearchCalls.length).toBe(0)
  })

  it('does not call live search when liveNetwork is true but text is empty', async () => {
    liveSearchCalls.length = 0
    vi.doMock('../../src/lib/authz/session', () => ({ getActor }))
    const { POST } = await import('../../src/app/api/search/route')
    const req = new Request('http://x/vidi/api/search', {
      method: 'POST',
      body: JSON.stringify({ orgId: 1, filters: { text: '', liveNetwork: true } }),
    })
    await POST(req as any)
    expect(liveSearchCalls.length).toBe(0)
  })

  it('merges live results not already in the local index, marking indexed correctly', async () => {
    liveSearchCalls.length = 0
    liveActorsResult.length = 0
    liveActorsResult.push(
      { did: 'did:plc:verified', handle: 'verified.bsky.social', displayName: null, description: null, isCustomDomain: false },
      { did: 'did:plc:live-only', handle: 'newfound.brussels', displayName: 'New', description: null, isCustomDomain: true }
    )
    verificationRows = []
    vi.doMock('../../src/lib/authz/session', () => ({ getActor }))
    const { POST } = await import('../../src/app/api/search/route')
    const req = new Request('http://x/vidi/api/search', {
      method: 'POST',
      body: JSON.stringify({ orgId: 1, filters: { text: 'brussels', liveNetwork: true } }),
    })
    const res = await POST(req as any)
    const body = await res.json()
    expect(liveSearchCalls[0]).toEqual(['brussels', 25])
    // did:plc:verified came from the local mock too -> local (indexed:true) wins, not duplicated
    const verified = body.results.filter((r: any) => r.did === 'did:plc:verified')
    expect(verified).toHaveLength(1)
    expect(verified[0].indexed).toBe(true)
    // did:plc:live-only only came from live search -> indexed:false
    const liveOnly = body.results.find((r: any) => r.did === 'did:plc:live-only')
    expect(liveOnly.indexed).toBe(false)
    expect(liveOnly.handle).toBe('newfound.brussels')
    // did:plc:plain came only from local -> indexed:true
    const plain = body.results.find((r: any) => r.did === 'did:plc:plain')
    expect(plain.indexed).toBe(true)
  })

  it('filters live results by customDomainOnly when that filter is also set', async () => {
    liveSearchCalls.length = 0
    liveActorsResult.length = 0
    liveActorsResult.push(
      { did: 'did:plc:live-domain', handle: 'x.brussels', displayName: null, description: null, isCustomDomain: true },
      { did: 'did:plc:live-platform', handle: 'y.bsky.social', displayName: null, description: null, isCustomDomain: false }
    )
    verificationRows = []
    vi.doMock('../../src/lib/authz/session', () => ({ getActor }))
    const { POST } = await import('../../src/app/api/search/route')
    const req = new Request('http://x/vidi/api/search', {
      method: 'POST',
      body: JSON.stringify({ orgId: 1, filters: { text: 'x', liveNetwork: true, customDomainOnly: true } }),
    })
    const res = await POST(req as any)
    const body = await res.json()
    expect(body.results.find((r: any) => r.did === 'did:plc:live-domain')).toBeTruthy()
    expect(body.results.find((r: any) => r.did === 'did:plc:live-platform')).toBeUndefined()
  })
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/api/search.test.ts`
Expected: FAIL — `src/lib/search/liveSearch` import used by the route doesn't exist yet, and `indexed` is not in the response.

- [ ] **Step 3: Implement**

Replace `src/app/api/search/route.ts` in full:
```ts
import { NextRequest, NextResponse } from 'next/server'
import { eq, inArray } from 'drizzle-orm'
import { getActor } from '../../../lib/authz/session'
import { assertActiveMember, AuthzError } from '../../../lib/authz/membership'
import { searchAccounts } from '../../../lib/search/queryBuilder'
import { searchActorsLive, type LiveActor } from '../../../lib/search/liveSearch'
import { db } from '../../../db/client'
import { accountVerifications, trustedVerifiers, orgs } from '../../../db/schema'

export type Verifier = { did: string; handle: string | null }

export async function POST(req: NextRequest) {
  const actor = await getActor()
  if (!actor) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })
  const { orgId, filters } = await req.json()
  try {
    await assertActiveMember(actor.did, orgId)
  } catch (e) {
    if (e instanceof AuthzError) return NextResponse.json({ error: e.message }, { status: e.status })
    throw e
  }

  const results = await searchAccounts(filters ?? {})

  let liveResults: LiveActor[] = []
  if (filters?.liveNetwork && filters?.text) {
    try {
      liveResults = await searchActorsLive(filters.text, 25)
    } catch (err) {
      console.error('search: live network search failed', err)
    }
    if (filters.customDomainOnly) {
      liveResults = liveResults.filter((a) => a.isCustomDomain)
    }
  }

  const localDids = new Set(results.map((r) => r.did))
  const liveOnly = liveResults.filter((a) => !localDids.has(a.did))
  const combined = [
    ...results.map((r) => ({ ...r, indexed: true as const })),
    ...liveOnly.map((a) => ({ ...a, indexed: false as const })),
  ]

  const allDids = combined.map((r) => r.did)
  const verifiersByDid = new Map<string, Verifier[]>()
  if (allDids.length) {
    const rows = await db
      .select({
        subjectDid: accountVerifications.subjectDid,
        verifierDid: accountVerifications.verifierDid,
        // Prefer Mu's official trusted-verifier list (when configured); fall
        // back to our own onboarded org handle, since a self-verifying org
        // won't appear on that externally-sourced list until Mu adds it.
        tvHandle: trustedVerifiers.handle,
        orgHandle: orgs.handle,
      })
      .from(accountVerifications)
      .leftJoin(trustedVerifiers, eq(accountVerifications.verifierDid, trustedVerifiers.did))
      .leftJoin(orgs, eq(accountVerifications.verifierDid, orgs.did))
      .where(inArray(accountVerifications.subjectDid, allDids))

    for (const row of rows) {
      const list = verifiersByDid.get(row.subjectDid) ?? []
      list.push({ did: row.verifierDid, handle: row.tvHandle ?? row.orgHandle ?? null })
      verifiersByDid.set(row.subjectDid, list)
    }
  }

  return NextResponse.json({
    results: combined.map((r) => ({ ...r, verifiers: verifiersByDid.get(r.did) ?? [] })),
  })
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/api/search.test.ts`
Expected: PASS (all cases, including the 4 pre-existing ones).

- [ ] **Step 5: Run the full suite and tsc**

Run: `npx tsc --noEmit && npm test`
Expected: tsc clean; all tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/app/api/search/route.ts tests/api/search.test.ts
git commit -m "feat(search): merge live network results into search, tagged with indexed flag"
```

---

## Task 4: SearchForm — live-network checkbox

**Files:**
- Modify: `src/components/SearchForm.tsx` (full file)
- Test: `tests/ui/searchForm.test.tsx` (extend — check current file first, path may be `tests/ui/searchForm.test.tsx` per existing convention)

**Interfaces:**
- Produces: `SearchFilters` type gains `liveNetwork: boolean`. `onSearch` callback receives it in the same object as before.

- [ ] **Step 1: Read the current test file to match its exact query/render conventions**

Run: `cat tests/ui/searchForm.test.tsx` and note how it renders `<SearchForm>` (props passed) and which testing-library queries it uses (`getByLabelText`, `fireEvent`, etc.) before writing the new test, so the addition matches established style exactly.

- [ ] **Step 2: Write the failing test**

Add this test to `tests/ui/searchForm.test.tsx` (adapt the render setup — trusted verifiers prop, imports — to match the file's existing pattern exactly):
```tsx
it('disables and clears the verified-by and followed-by-verified controls when live network is checked', () => {
  const onSearch = vi.fn()
  render(<SearchForm trustedVerifiers={[{ did: 'did:plc:tv', handle: 'tv.example' }]} onSearch={onSearch} />)

  const followedCheckbox = screen.getByLabelText(/followed by a verified account/i) as HTMLInputElement
  const tvCheckbox = screen.getByLabelText(/tv\.example/i) as HTMLInputElement
  fireEvent.click(followedCheckbox)
  fireEvent.click(tvCheckbox)
  expect(followedCheckbox.checked).toBe(true)
  expect(tvCheckbox.checked).toBe(true)

  const liveCheckbox = screen.getByLabelText(/search the live network/i) as HTMLInputElement
  fireEvent.click(liveCheckbox)

  expect(followedCheckbox.checked).toBe(false)
  expect(followedCheckbox.disabled).toBe(true)
  expect(tvCheckbox.checked).toBe(false)
  expect(tvCheckbox.disabled).toBe(true)
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run tests/ui/searchForm.test.tsx`
Expected: FAIL — no "search the live network" label exists yet.

- [ ] **Step 4: Implement**

Replace `src/components/SearchForm.tsx` in full:
```tsx
'use client'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

type TV = { did: string; handle: string }

export type SearchFilters = {
  text: string
  customDomainOnly: boolean
  followedByVerified: boolean
  verifiedByAnyOf: string[]
  liveNetwork: boolean
}

export function SearchForm({
  trustedVerifiers,
  onSearch,
}: {
  trustedVerifiers: TV[]
  onSearch: (filters: SearchFilters) => void
}) {
  const [text, setText] = useState('')
  const [customDomainOnly, setCustomDomainOnly] = useState(false)
  const [followedByVerified, setFollowedByVerified] = useState(false)
  const [verifiedByAnyOf, setVerifiedByAnyOf] = useState<string[]>([])
  const [liveNetwork, setLiveNetwork] = useState(false)

  function toggleLiveNetwork(checked: boolean) {
    setLiveNetwork(checked)
    if (checked) {
      setFollowedByVerified(false)
      setVerifiedByAnyOf([])
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Filters</CardTitle>
      </CardHeader>
      <CardContent>
        <form
          className="flex flex-col gap-5"
          onSubmit={(e) => {
            e.preventDefault()
            onSearch({ text, customDomainOnly, followedByVerified, verifiedByAnyOf, liveNetwork })
          }}
        >
          <div className="flex flex-col gap-2">
            <Label htmlFor="search-text">Text in bio or handle</Label>
            <Input id="search-text" value={text} onChange={(e) => setText(e.target.value)} />
          </div>

          <div className="flex flex-col gap-3">
            <Label className="flex items-center gap-2">
              <Checkbox
                id="search-custom-domain"
                checked={customDomainOnly}
                onCheckedChange={(checked) => setCustomDomainOnly(checked === true)}
              />
              Handle is a domain
            </Label>
            <Label className="flex items-center gap-2">
              <Checkbox
                id="search-followed-by-verified"
                checked={followedByVerified}
                disabled={liveNetwork}
                onCheckedChange={(checked) => setFollowedByVerified(checked === true)}
              />
              Followed by a verified account
            </Label>
          </div>

          <fieldset className="flex flex-col gap-3">
            <legend className="mb-1 text-sm font-medium">Verified by</legend>
            {trustedVerifiers.map((tv) => (
              <Label key={tv.did} className="flex items-center gap-2">
                <Checkbox
                  id={`tv-${tv.did}`}
                  checked={verifiedByAnyOf.includes(tv.did)}
                  disabled={liveNetwork}
                  onCheckedChange={(checked) =>
                    setVerifiedByAnyOf((prev) =>
                      checked === true ? [...prev, tv.did] : prev.filter((d) => d !== tv.did)
                    )
                  }
                />
                {tv.handle}
              </Label>
            ))}
          </fieldset>

          <div className="flex flex-col gap-1">
            <Label className="flex items-center gap-2">
              <Checkbox
                id="search-live-network"
                checked={liveNetwork}
                onCheckedChange={(checked) => toggleLiveNetwork(checked === true)}
              />
              Search the live network too
            </Label>
            <p className="pl-6 text-xs text-muted-foreground">
              Requires text above. Only matches text/domain — verified-by filters don&apos;t apply live.
            </p>
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

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/ui/searchForm.test.tsx`
Expected: PASS (including the new test and all pre-existing ones).

- [ ] **Step 6: Commit**

```bash
git add src/components/SearchForm.tsx tests/ui/searchForm.test.tsx
git commit -m "feat(search): live-network checkbox disables and clears graph-dependent filters"
```

---

## Task 5: "Not yet indexed" badge + backlog upsert fields

**Files:**
- Modify: `src/components/AccountCard.tsx` (full file)
- Modify: `src/app/(app)/search/page.tsx` (full file)
- Test: none new (visual/wiring change over already-tested components; covered by Task 3's route test for the `indexed` flag itself and existing UI tests continuing to pass)

**Interfaces:**
- Consumes: `indexed: boolean` field now present on every search result (Task 3).

- [ ] **Step 1: Update AccountCard.tsx**

Replace `src/components/AccountCard.tsx` in full:
```tsx
'use client'

import { Checkbox } from '@/components/ui/checkbox'
import { Badge } from '@/components/ui/badge'
import { Label } from '@/components/ui/label'
import { Card, CardContent } from '@/components/ui/card'

type Verifier = { did: string; handle: string | null }

type Account = {
  did: string
  handle: string
  displayName?: string | null
  description?: string | null
  isCustomDomain?: boolean
  verifiers?: Verifier[]
  indexed?: boolean
}

export function AccountCard({
  acc,
  selected,
  onToggle,
}: {
  acc: Account
  selected: boolean
  onToggle: () => void
}) {
  const verifiers = acc.verifiers ?? []
  return (
    <Card className="transition-colors hover:bg-muted/40">
      <CardContent className="flex items-start gap-3">
        <Checkbox
          id={`acc-${acc.did}`}
          checked={selected}
          onCheckedChange={onToggle}
          className="mt-1"
        />
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <Label htmlFor={`acc-${acc.did}`} className="flex flex-wrap items-center gap-2">
            <span className="font-semibold">{acc.displayName || acc.handle}</span>
            <span className="text-muted-foreground">@{acc.handle}</span>
            {acc.isCustomDomain && <Badge variant="secondary">custom domain</Badge>}
            {acc.indexed === false && <Badge variant="secondary">Not yet indexed</Badge>}
            {verifiers.length > 0 && (
              <Badge variant="outline">
                Verified by {verifiers.map((v) => v.handle ?? v.did).join(', ')}
              </Badge>
            )}
          </Label>
          <a
            href={`https://mu.social/profile/${acc.handle}`}
            target="_blank"
            rel="noopener noreferrer"
            className="w-fit text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
          >
            View on Mu ↗
          </a>
          {acc.description && <p className="text-sm text-muted-foreground">{acc.description}</p>}
        </div>
      </CardContent>
    </Card>
  )
}
```

- [ ] **Step 2: Update the search page's Account type and backlog() function**

In `src/app/(app)/search/page.tsx`, replace the `Account` type and the `backlog` function:

Replace:
```ts
type Account = {
  did: string
  handle: string
  displayName?: string | null
  description?: string | null
  isCustomDomain?: boolean
  verifiers?: { did: string; handle: string | null }[]
}
```
with:
```ts
type Account = {
  did: string
  handle: string
  displayName?: string | null
  description?: string | null
  isCustomDomain?: boolean
  verifiers?: { did: string; handle: string | null }[]
  indexed?: boolean
}
```

Replace:
```ts
  async function backlog() {
    const targets = results.filter((x) => sel.has(x.did))
    for (const a of targets) {
      await fetch('/vidi/api/backlog', {
        method: 'POST',
        body: JSON.stringify({ orgId, subjectDid: a.did }),
      })
    }
    toast.success('Added to backlog')
  }
```
with:
```ts
  async function backlog() {
    const targets = results.filter((x) => sel.has(x.did))
    for (const a of targets) {
      await fetch('/vidi/api/backlog', {
        method: 'POST',
        body: JSON.stringify({
          orgId,
          subjectDid: a.did,
          ...(a.indexed === false
            ? {
                handle: a.handle,
                displayName: a.displayName,
                description: a.description,
                isCustomDomain: a.isCustomDomain,
              }
            : {}),
        }),
      })
    }
    toast.success('Added to backlog')
  }
```

- [ ] **Step 3: Run full suite and tsc**

Run: `npx tsc --noEmit && npm test`
Expected: tsc clean; all tests pass (no test asserted the OLD backlog body shape strictly, since the addition is purely additive fields).

- [ ] **Step 4: Commit**

```bash
git add src/components/AccountCard.tsx "src/app/(app)/search/page.tsx"
git commit -m "feat(search): show not-yet-indexed badge, pass profile fields to backlog for live results"
```

---

## Task 6: Shared accounts upsert helper (`upsertAccountRow`)

**Files:**
- Modify: `src/crawler/hydrate.ts` (full file)
- Test: `tests/crawler/hydrate.test.ts` (already exists — confirmed during plan authoring; contains one test calling `toAccountRow({did,handle,displayName,description,avatar}, 'keyword')` and asserting `isCustomDomain`/`seedSource`. Its signature is untouched by this refactor, so it needs no changes — just re-run it to confirm.)

**Interfaces:**
- Produces: `type AccountRow = { did: string; handle: string; displayName: string | null; description: string | null; avatar: string | null; isCustomDomain: boolean; seedSource: string }`; `upsertAccountRow(row: AccountRow): Promise<void>`. `toAccountRow`'s existing signature and behavior are UNCHANGED. `hydrateAccounts`'s existing signature and behavior are UNCHANGED (internal refactor only).

- [ ] **Step 1: Confirm the existing test still passes before refactoring (baseline)**

Run: `npx vitest run tests/crawler/hydrate.test.ts`
Expected: PASS (1/1) — this is the pre-refactor baseline.

- [ ] **Step 2: Refactor hydrate.ts**

Replace `src/crawler/hydrate.ts` in full:
```ts
import type { AtpAgent, AppBskyActorDefs } from '@atproto/api'
import { db } from '../db/client'
import { accounts } from '../db/schema'
import { isCustomDomain } from '../lib/domain/handleClassifier'

export type AccountRow = {
  did: string
  handle: string
  displayName: string | null
  description: string | null
  avatar: string | null
  isCustomDomain: boolean
  seedSource: string
}

export function toAccountRow(p: AppBskyActorDefs.ProfileViewDetailed, seedSource: string): AccountRow {
  return {
    did: p.did,
    handle: p.handle,
    displayName: p.displayName ?? null,
    description: p.description ?? null,
    avatar: p.avatar ?? null,
    isCustomDomain: isCustomDomain(p.handle),
    seedSource,
  }
}

export async function upsertAccountRow(row: AccountRow): Promise<void> {
  await db.insert(accounts).values(row)
    .onConflictDoUpdate({
      target: accounts.did,
      set: {
        handle: row.handle,
        displayName: row.displayName,
        description: row.description,
        avatar: row.avatar,
        isCustomDomain: row.isCustomDomain,
      },
    })
}

export async function hydrateAccounts(agent: AtpAgent, dids: string[], seedSource = 'crawl'): Promise<void> {
  for (let i = 0; i < dids.length; i += 25) {
    const batch = dids.slice(i, i + 25)
    try {
      const { data } = await agent.getProfiles({ actors: batch })
      for (const p of data.profiles) {
        try {
          await upsertAccountRow(toAccountRow(p, seedSource))
        } catch (err) {
          console.error(`hydrateAccounts: failed to upsert account ${p.did}`, err)
        }
      }
    } catch (err) {
      console.error(`hydrateAccounts: failed to fetch profiles for batch starting at index ${i}`, err)
    }
  }
}
```

- [ ] **Step 3: Run full suite and tsc**

Run: `npx tsc --noEmit && npm test`
Expected: tsc clean; all existing hydrate/crawler tests still pass unchanged (the refactor preserves `toAccountRow`'s and `hydrateAccounts`'s external behavior exactly — only the upsert call was extracted, not altered).

- [ ] **Step 4: Commit**

```bash
git add src/crawler/hydrate.ts
git commit -m "refactor(crawler): extract upsertAccountRow, reused by verify/backlog upsert-on-action"
```

---

## Task 7: Upsert accounts row when verify falls back to a live profile

**Files:**
- Modify: `src/lib/verify/verifyService.ts` (targeted edit)
- Test: `tests/lib/verifyService.test.ts` (extend)

**Interfaces:**
- Consumes: `upsertAccountRow(row)` from Task 6; `isCustomDomain(handle)`.
- Produces: no change to `resolveSubjectIdentity`'s return type or `verifyOne`/`revokeOne`'s external signatures — purely an added side effect on the fallback path.

- [ ] **Step 1: Read the current verifyService test file's fallback test case**

Run: `grep -n "fallback" tests/lib/verifyService.test.ts` to find the existing test asserting the `getProfile` fallback path, so the new assertion is added to (or alongside) that exact test rather than duplicating its setup.

- [ ] **Step 2: Write the failing test**

Add this test to `tests/lib/verifyService.test.ts` (adapt to the file's exact existing mock variable names for `accountsSelectResult`, `publicGetProfile`, and the recording `calls` object — confirmed present from Task context):
```ts
it('upserts an accounts row when identity resolution falls back to the live profile', async () => {
  accountsSelectResult = [] // not indexed yet
  checkGuards.mockResolvedValue({ ok: true })
  publicGetProfile.mockResolvedValue({
    data: { handle: 'newfound.brussels', displayName: 'New Account', description: 'a bio', avatar: null },
  })
  createRecord.mockResolvedValue({ data: { uri: 'at://did:plc:org/app.bsky.graph.verification/rk1', cid: 'x' } })

  await verifyOne({ org: { id: 1, did: 'did:plc:org' }, actorDid: 'did:plc:member', subject: { did: 'did:plc:newfound' } })

  const accountsInsert = calls.inserts.find((i) => (i.values as any)?.did === 'did:plc:newfound')
  expect(accountsInsert).toBeTruthy()
  expect((accountsInsert!.values as any).handle).toBe('newfound.brussels')
  expect((accountsInsert!.values as any).seedSource).toBe('verify-fallback')
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run tests/lib/verifyService.test.ts`
Expected: FAIL — no `accounts` insert happens on the fallback path yet.

- [ ] **Step 4: Implement**

In `src/lib/verify/verifyService.ts`, update the imports and `resolveSubjectIdentity`:

Replace:
```ts
import { and, eq } from 'drizzle-orm'
import { db } from '../../db/client'
import { accountVerifications, accounts, verificationActions } from '../../db/schema'
import { getOrgAgent } from '../atproto/orgAgent'
import { getPublicAppViewAgent } from '../atproto/publicAgent'
import { checkGuards } from './guardrails'
```
with:
```ts
import { and, eq } from 'drizzle-orm'
import { db } from '../../db/client'
import { accountVerifications, accounts, verificationActions } from '../../db/schema'
import { getOrgAgent } from '../atproto/orgAgent'
import { getPublicAppViewAgent } from '../atproto/publicAgent'
import { isCustomDomain } from '../domain/handleClassifier'
import { upsertAccountRow } from '../../crawler/hydrate'
import { checkGuards } from './guardrails'
```

Replace:
```ts
async function resolveSubjectIdentity(did: string): Promise<{ handle: string; displayName?: string }> {
  const rows = await db.select().from(accounts).where(eq(accounts.did, did))
  if (rows[0]) {
    return { handle: rows[0].handle, displayName: rows[0].displayName ?? undefined }
  }
  const prof = await getPublicAppViewAgent().getProfile({ actor: did })
  return { handle: prof.data.handle, displayName: prof.data.displayName }
}
```
with:
```ts
async function resolveSubjectIdentity(did: string): Promise<{ handle: string; displayName?: string }> {
  const rows = await db.select().from(accounts).where(eq(accounts.did, did))
  if (rows[0]) {
    return { handle: rows[0].handle, displayName: rows[0].displayName ?? undefined }
  }
  const prof = await getPublicAppViewAgent().getProfile({ actor: did })
  // Not yet in our index (e.g. a live-search result): persist it now so it
  // shows up correctly, badges and all, in the very next local search.
  await upsertAccountRow({
    did,
    handle: prof.data.handle,
    displayName: prof.data.displayName ?? null,
    description: prof.data.description ?? null,
    avatar: prof.data.avatar ?? null,
    isCustomDomain: isCustomDomain(prof.data.handle),
    seedSource: 'verify-fallback',
  })
  return { handle: prof.data.handle, displayName: prof.data.displayName }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/lib/verifyService.test.ts`
Expected: PASS (including the new test and all pre-existing ones).

- [ ] **Step 6: Run full suite and tsc**

Run: `npx tsc --noEmit && npm test`
Expected: tsc clean; all tests pass.

- [ ] **Step 7: Commit**

```bash
git add src/lib/verify/verifyService.ts tests/lib/verifyService.test.ts
git commit -m "feat(verify): index a not-yet-indexed subject when identity falls back to a live profile"
```

---

## Task 8: Backlog route upserts accounts for live-only results

**Files:**
- Modify: `src/app/api/backlog/route.ts` (full file)
- Create: `tests/api/backlog.test.ts` (does not exist yet — confirmed by checking `ls tests/api/` during plan authoring)

**Interfaces:**
- Consumes: `upsertAccountRow(row)` from Task 6; `isCustomDomain(handle)`.
- Produces: `POST /vidi/api/backlog` accepts optional `handle`, `displayName`, `description`, `isCustomDomain` fields in addition to the existing `{orgId, subjectDid, note}`. When `handle` is present, an `accounts` row is upserted before the backlog insert.

- [ ] **Step 1: Write the failing test**

`tests/api/backlog.test.ts` (new file):
```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../src/lib/authz/session', () => ({ getActor: async () => ({ did: 'did:plc:a' }) }))
vi.mock('../../src/lib/authz/membership', () => ({
  assertActiveMember: async () => {},
  AuthzError: class extends Error {
    status = 403
  },
}))

// Records every insert's values. Discriminate by shape rather than Drizzle
// table identity: an accounts row always has `handle`; a backlogItems row
// always has `subjectDid` + `status` and never `handle`.
const insertedValues: Record<string, unknown>[] = []
vi.mock('../../src/db/client', () => ({
  db: {
    insert: () => ({
      values: (values: Record<string, unknown>) => {
        insertedValues.push(values)
        return { onConflictDoUpdate: async () => {} }
      },
    }),
  },
}))

import { POST } from '../../src/app/api/backlog/route'

beforeEach(() => {
  insertedValues.length = 0
})

describe('backlog route account upsert', () => {
  it('upserts an accounts row when handle is provided (live-only result)', async () => {
    const req = new Request('http://x/vidi/api/backlog', {
      method: 'POST',
      body: JSON.stringify({
        orgId: 1,
        subjectDid: 'did:plc:live',
        handle: 'newfound.brussels',
        displayName: 'New',
        description: 'bio',
        isCustomDomain: true,
      }),
    })
    await POST(req as any)
    const accountsInsert = insertedValues.find((v) => 'handle' in v)
    expect(accountsInsert).toBeTruthy()
    expect(accountsInsert!.handle).toBe('newfound.brussels')
    expect(accountsInsert!.isCustomDomain).toBe(true)
    const backlogInsert = insertedValues.find((v) => 'subjectDid' in v && 'status' in v)
    expect(backlogInsert).toBeTruthy()
  })

  it('does not touch accounts when handle is absent (already-indexed result)', async () => {
    const req = new Request('http://x/vidi/api/backlog', {
      method: 'POST',
      body: JSON.stringify({ orgId: 1, subjectDid: 'did:plc:indexed' }),
    })
    await POST(req as any)
    const accountsInsert = insertedValues.find((v) => 'handle' in v)
    expect(accountsInsert).toBeUndefined()
    const backlogInsert = insertedValues.find((v) => 'subjectDid' in v && 'status' in v)
    expect(backlogInsert).toBeTruthy()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/api/backlog.test.ts`
Expected: FAIL — no accounts upsert happens yet.

- [ ] **Step 3: Implement**

Replace `src/app/api/backlog/route.ts` in full:
```ts
import { NextRequest, NextResponse } from 'next/server'
import { and, eq } from 'drizzle-orm'
import { db } from '../../../db/client'
import { backlogItems } from '../../../db/schema'
import { getActor } from '../../../lib/authz/session'
import { assertActiveMember, AuthzError } from '../../../lib/authz/membership'
import { upsertAccountRow } from '../../../crawler/hydrate'
import { isCustomDomain } from '../../../lib/domain/handleClassifier'

function guard<T>(fn: () => Promise<T>) {
  return fn().catch((e) => {
    if (e instanceof AuthzError) return NextResponse.json({ error: e.message }, { status: e.status })
    throw e
  })
}

export async function GET(req: NextRequest) {
  return guard(async () => {
    const actor = await getActor(); if (!actor) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })
    const orgId = Number(req.nextUrl.searchParams.get('orgId'))
    await assertActiveMember(actor.did, orgId)
    const rows = await db.select().from(backlogItems).where(and(eq(backlogItems.orgId, orgId), eq(backlogItems.status, 'pending')))
    return NextResponse.json({ items: rows })
  })
}

export async function POST(req: NextRequest) {
  return guard(async () => {
    const actor = await getActor(); if (!actor) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })
    const { orgId, subjectDid, note, handle, displayName, description, isCustomDomain: isDomain } = await req.json()
    await assertActiveMember(actor.did, orgId)
    if (handle) {
      await upsertAccountRow({
        did: subjectDid,
        handle,
        displayName: displayName ?? null,
        description: description ?? null,
        avatar: null,
        isCustomDomain: isDomain ?? isCustomDomain(handle),
        seedSource: 'backlog',
      })
    }
    await db.insert(backlogItems).values({ orgId, subjectDid, note, addedByDid: actor.did, status: 'pending' })
      .onConflictDoUpdate({ target: [backlogItems.orgId, backlogItems.subjectDid], set: { status: 'pending', note } })
    return NextResponse.json({ ok: true })
  })
}

export async function PATCH(req: NextRequest) {
  return guard(async () => {
    const actor = await getActor(); if (!actor) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })
    const { orgId, subjectDid, status } = await req.json()
    await assertActiveMember(actor.did, orgId)
    await db.update(backlogItems).set({ status })
      .where(and(eq(backlogItems.orgId, orgId), eq(backlogItems.subjectDid, subjectDid)))
    return NextResponse.json({ ok: true })
  })
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/api/backlog.test.ts`
Expected: PASS.

- [ ] **Step 5: Run full suite and tsc**

Run: `npx tsc --noEmit && npm test`
Expected: tsc clean; all tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/app/api/backlog/route.ts tests/api/backlog.test.ts
git commit -m "feat(backlog): index a not-yet-indexed subject when profile fields are provided"
```

---

## Task 9: Crawler always crawls onboarded orgs' own verification records

**Files:**
- Modify: `src/crawler/run.ts` (targeted edit)
- Test: none new (orchestration-only file, established precedent from its original build: must compile cleanly, verified live — see spec's Verification plan)

**Interfaces:**
- No exported signature changes to `runCrawl`.

- [ ] **Step 1: Update run.ts**

In `src/crawler/run.ts`, replace:
```ts
import { AtpAgent } from '@atproto/api'
import { eq } from 'drizzle-orm'
import { db } from '../db/client'
import { accountSignals, crawlRuns } from '../db/schema'
import { syncTrustedVerifiers } from './trustedVerifiers'
import { crawlVerifications, type VerificationEdge } from './verificationsCrawl'
import { collectFollowedByVerified } from './followsCrawl'
import { runKeywordSeed } from './keywordSeed'
import { hydrateAccounts } from './hydrate'
import { validateEnv } from '../lib/env'
import { isMain } from '../lib/isMain'
```
with:
```ts
import { AtpAgent } from '@atproto/api'
import { eq } from 'drizzle-orm'
import { db } from '../db/client'
import { accountSignals, crawlRuns, orgs } from '../db/schema'
import { syncTrustedVerifiers } from './trustedVerifiers'
import { crawlVerifications, type VerificationEdge } from './verificationsCrawl'
import { collectFollowedByVerified } from './followsCrawl'
import { runKeywordSeed } from './keywordSeed'
import { hydrateAccounts } from './hydrate'
import { validateEnv } from '../lib/env'
import { isMain } from '../lib/isMain'
```

Replace:
```ts
  let verifierDids: string[] = []
  try {
    verifierDids = await syncTrustedVerifiers(agent)
  } catch (err) {
    console.error('runCrawl: syncTrustedVerifiers failed', err)
  }

  let edges: VerificationEdge[] = []
```
with:
```ts
  let verifierDids: string[] = []
  try {
    verifierDids = await syncTrustedVerifiers(agent)
  } catch (err) {
    console.error('runCrawl: syncTrustedVerifiers failed', err)
  }

  // An onboarded org IS a trusted verifier by definition (that's the entire
  // premise of the allowlist gate) — always crawl its own verification
  // records too, independent of whether it also happens to be on Mu's
  // external TRUSTED_VERIFIER_LIST_URIS list.
  try {
    const ownOrgs = await db.select({ did: orgs.did }).from(orgs)
    verifierDids = [...new Set([...verifierDids, ...ownOrgs.map((o) => o.did)])]
  } catch (err) {
    console.error('runCrawl: failed to load org DIDs for self-verification crawl', err)
  }

  let edges: VerificationEdge[] = []
```

- [ ] **Step 2: Run full suite and tsc**

Run: `npx tsc --noEmit && npm test`
Expected: tsc clean; all tests pass (no existing test exercises `runCrawl`'s internals per established precedent).

- [ ] **Step 3: Commit**

```bash
git add src/crawler/run.ts
git commit -m "fix(crawler): always crawl onboarded orgs' own verification records"
```

---

## Task 10: Crawl-seeds API (owner-only)

**Files:**
- Create: `src/app/api/crawl-seeds/route.ts`
- Test: `tests/api/crawlSeeds.test.ts`

**Interfaces:**
- Consumes: `getActor`, `assertOwner`, `AuthzError` (existing patterns from `src/app/api/members/route.ts`).
- Produces: `GET /vidi/api/crawl-seeds` → `{ seeds: {id, keyword, enabled}[] }` (owner-only); `POST /vidi/api/crawl-seeds {orgId, keyword}` → upsert, `enabled: true` (owner-only); `PATCH /vidi/api/crawl-seeds {orgId, keyword, enabled}` → toggle (owner-only).

- [ ] **Step 1: Write the failing tests**

`tests/api/crawlSeeds.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../src/lib/authz/membership', () => ({
  assertOwner: (...args: unknown[]) => assertOwnerMock(...args),
  AuthzError: class extends Error {
    status = 403
  },
}))
const assertOwnerMock = vi.fn()

let seedRows: unknown[] = []
const insertCalls: Array<{ values: unknown; conflict: unknown }> = []
const updateCalls: Array<{ set: unknown; where: unknown }> = []

vi.mock('../../src/db/client', () => ({
  db: {
    select: () => ({ from: () => seedRows }),
    insert: () => ({
      values: (values: unknown) => ({
        onConflictDoUpdate: (conflict: unknown) => {
          insertCalls.push({ values, conflict })
          return Promise.resolve()
        },
      }),
    }),
    update: () => ({
      set: (set: unknown) => ({
        where: (where: unknown) => {
          updateCalls.push({ set, where })
          return Promise.resolve()
        },
      }),
    }),
  },
}))

describe('crawl-seeds route', () => {
  beforeEach(() => {
    vi.resetModules()
    seedRows = [{ id: 1, keyword: 'brussels', enabled: true }]
    insertCalls.length = 0
    updateCalls.length = 0
    assertOwnerMock.mockReset()
  })

  it('401 when not logged in (GET)', async () => {
    vi.doMock('../../src/lib/authz/session', () => ({ getActor: async () => null }))
    const { GET } = await import('../../src/app/api/crawl-seeds/route')
    const req = new Request('http://x/vidi/api/crawl-seeds?orgId=1')
    expect((await GET(req as any)).status).toBe(401)
  })

  it('403 when not owner (GET)', async () => {
    vi.doMock('../../src/lib/authz/session', () => ({ getActor: async () => ({ did: 'did:plc:helper' }) }))
    assertOwnerMock.mockImplementation(async () => {
      const { AuthzError } = await import('../../src/lib/authz/membership')
      throw new AuthzError('owner required')
    })
    const { GET } = await import('../../src/app/api/crawl-seeds/route')
    const req = new Request('http://x/vidi/api/crawl-seeds?orgId=1')
    expect((await GET(req as any)).status).toBe(403)
  })

  it('lists seeds for an owner', async () => {
    vi.doMock('../../src/lib/authz/session', () => ({ getActor: async () => ({ did: 'did:plc:owner' }) }))
    assertOwnerMock.mockResolvedValue(undefined)
    const { GET } = await import('../../src/app/api/crawl-seeds/route')
    const req = new Request('http://x/vidi/api/crawl-seeds?orgId=1')
    const res = await GET(req as any)
    const body = await res.json()
    expect(body.seeds).toEqual(seedRows)
  })

  it('POST upserts a keyword, re-enabling if it already exists', async () => {
    vi.doMock('../../src/lib/authz/session', () => ({ getActor: async () => ({ did: 'did:plc:owner' }) }))
    assertOwnerMock.mockResolvedValue(undefined)
    const { POST } = await import('../../src/app/api/crawl-seeds/route')
    const req = new Request('http://x/vidi/api/crawl-seeds', {
      method: 'POST',
      body: JSON.stringify({ orgId: 1, keyword: 'namur' }),
    })
    const res = await POST(req as any)
    expect(res.status).toBe(200)
    expect(insertCalls[0].values).toEqual({ keyword: 'namur', enabled: true })
  })

  it('PATCH toggles enabled state', async () => {
    vi.doMock('../../src/lib/authz/session', () => ({ getActor: async () => ({ did: 'did:plc:owner' }) }))
    assertOwnerMock.mockResolvedValue(undefined)
    const { PATCH } = await import('../../src/app/api/crawl-seeds/route')
    const req = new Request('http://x/vidi/api/crawl-seeds', {
      method: 'PATCH',
      body: JSON.stringify({ orgId: 1, keyword: 'namur', enabled: false }),
    })
    const res = await PATCH(req as any)
    expect(res.status).toBe(200)
    expect(updateCalls[0].set).toEqual({ enabled: false })
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/api/crawlSeeds.test.ts`
Expected: FAIL — `src/app/api/crawl-seeds/route.ts` does not exist.

- [ ] **Step 3: Implement**

`src/app/api/crawl-seeds/route.ts`:
```ts
import { NextRequest, NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { db } from '../../../db/client'
import { crawlSeeds } from '../../../db/schema'
import { getActor } from '../../../lib/authz/session'
import { assertOwner, AuthzError } from '../../../lib/authz/membership'

function guard<T>(fn: () => Promise<T>) {
  return fn().catch((e) => {
    if (e instanceof AuthzError) return NextResponse.json({ error: e.message }, { status: e.status })
    throw e
  })
}

export async function GET(req: NextRequest) {
  return guard(async () => {
    const actor = await getActor(); if (!actor) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })
    const orgId = Number(req.nextUrl.searchParams.get('orgId'))
    await assertOwner(actor.did, orgId)
    const seeds = await db.select().from(crawlSeeds)
    return NextResponse.json({ seeds })
  })
}

export async function POST(req: NextRequest) {
  return guard(async () => {
    const actor = await getActor(); if (!actor) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })
    const { orgId, keyword } = await req.json()
    await assertOwner(actor.did, orgId)
    await db.insert(crawlSeeds).values({ keyword, enabled: true })
      .onConflictDoUpdate({ target: crawlSeeds.keyword, set: { enabled: true } })
    return NextResponse.json({ ok: true })
  })
}

export async function PATCH(req: NextRequest) {
  return guard(async () => {
    const actor = await getActor(); if (!actor) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })
    const { orgId, keyword, enabled } = await req.json()
    await assertOwner(actor.did, orgId)
    await db.update(crawlSeeds).set({ enabled }).where(eq(crawlSeeds.keyword, keyword))
    return NextResponse.json({ ok: true })
  })
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/api/crawlSeeds.test.ts`
Expected: PASS (all 5 cases).

- [ ] **Step 5: Run full suite and tsc**

Run: `npx tsc --noEmit && npm test`
Expected: tsc clean; all tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/app/api/crawl-seeds/route.ts tests/api/crawlSeeds.test.ts
git commit -m "feat(settings): owner-only crawl-seed keyword management API"
```

---

## Task 11: Manual crawl trigger API (owner-only, fire-and-forget)

**Files:**
- Create: `src/app/api/crawl/run/route.ts`
- Test: `tests/api/crawlRun.test.ts`

**Interfaces:**
- Consumes: `getActor`, `assertOwner`, `AuthzError`; `runCrawl` from `src/crawler/run.ts`.
- Produces: `POST /vidi/api/crawl/run {orgId}` → `{ ok: true, started: true }` (owner-only), returns before `runCrawl()` settles.

- [ ] **Step 1: Write the failing test**

`tests/api/crawlRun.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../src/lib/authz/membership', () => ({
  assertOwner: (...args: unknown[]) => assertOwnerMock(...args),
  AuthzError: class extends Error {
    status = 403
  },
}))
const assertOwnerMock = vi.fn()

let runCrawlResolve: (() => void) | null = null
const runCrawlMock = vi.fn(
  () =>
    new Promise<void>((resolve) => {
      runCrawlResolve = resolve
    })
)
vi.mock('../../src/crawler/run', () => ({ runCrawl: (...args: unknown[]) => runCrawlMock(...args) }))

describe('crawl/run route', () => {
  beforeEach(() => {
    vi.resetModules()
    assertOwnerMock.mockReset()
    runCrawlMock.mockClear()
    runCrawlResolve = null
  })

  it('401 when not logged in', async () => {
    vi.doMock('../../src/lib/authz/session', () => ({ getActor: async () => null }))
    const { POST } = await import('../../src/app/api/crawl/run/route')
    const req = new Request('http://x/vidi/api/crawl/run', { method: 'POST', body: JSON.stringify({ orgId: 1 }) })
    expect((await POST(req as any)).status).toBe(401)
  })

  it('403 when not owner', async () => {
    vi.doMock('../../src/lib/authz/session', () => ({ getActor: async () => ({ did: 'did:plc:helper' }) }))
    assertOwnerMock.mockImplementation(async () => {
      const { AuthzError } = await import('../../src/lib/authz/membership')
      throw new AuthzError('owner required')
    })
    const { POST } = await import('../../src/app/api/crawl/run/route')
    const req = new Request('http://x/vidi/api/crawl/run', { method: 'POST', body: JSON.stringify({ orgId: 1 }) })
    expect((await POST(req as any)).status).toBe(403)
  })

  it('responds immediately without awaiting runCrawl to finish', async () => {
    vi.doMock('../../src/lib/authz/session', () => ({ getActor: async () => ({ did: 'did:plc:owner' }) }))
    assertOwnerMock.mockResolvedValue(undefined)
    const { POST } = await import('../../src/app/api/crawl/run/route')
    const req = new Request('http://x/vidi/api/crawl/run', { method: 'POST', body: JSON.stringify({ orgId: 1 }) })
    const res = await POST(req as any)
    const body = await res.json()
    expect(body).toEqual({ ok: true, started: true })
    expect(runCrawlMock).toHaveBeenCalledTimes(1)
    // The route already resolved even though runCrawl's own promise has not:
    expect(runCrawlResolve).not.toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/api/crawlRun.test.ts`
Expected: FAIL — `src/app/api/crawl/run/route.ts` does not exist.

- [ ] **Step 3: Implement**

`src/app/api/crawl/run/route.ts`:
```ts
import { NextRequest, NextResponse } from 'next/server'
import { getActor } from '../../../../lib/authz/session'
import { assertOwner, AuthzError } from '../../../../lib/authz/membership'
import { runCrawl } from '../../../../crawler/run'

export async function POST(req: NextRequest) {
  const actor = await getActor()
  if (!actor) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })
  const { orgId } = await req.json()
  try {
    await assertOwner(actor.did, orgId)
  } catch (e) {
    if (e instanceof AuthzError) return NextResponse.json({ error: e.message }, { status: e.status })
    throw e
  }
  // Fire-and-forget: a full crawl can take minutes. Vidi runs as a long-lived
  // Node process (next start in Docker), not serverless, so this async call
  // keeps running after the response is sent — the same execution model the
  // scheduled worker process already relies on to run runCrawl() unattended.
  runCrawl().catch((err) => console.error('crawl/run: manual trigger failed', err))
  return NextResponse.json({ ok: true, started: true })
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/api/crawlRun.test.ts`
Expected: PASS (all 3 cases).

- [ ] **Step 5: Run full suite and tsc**

Run: `npx tsc --noEmit && npm test`
Expected: tsc clean; all tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/app/api/crawl/run/route.ts tests/api/crawlRun.test.ts
git commit -m "feat(settings): owner-only manual crawl trigger, fire-and-forget"
```

---

## Task 12: Settings page UI + owner-only nav visibility

**Files:**
- Create: `src/app/(app)/settings/page.tsx`
- Modify: `src/app/(app)/layout.tsx` (targeted edit)
- Test: `tests/ui/settings.test.tsx`

**Interfaces:**
- Consumes: `useOrg()` (existing, returns `role`); `GET/POST/PATCH /vidi/api/crawl-seeds`; `POST /vidi/api/crawl/run` (Tasks 10–11).
- Produces: named export `SettingsView({role, orgId, seeds}: {role: string; orgId: number; seeds: {id:number; keyword:string; enabled:boolean}[]})` for testability (mirrors the existing `MembersView` pattern in `src/app/(app)/members/page.tsx`), plus a default-exported `SettingsPage` that fetches data and renders it.

- [ ] **Step 1: Write the failing test**

`tests/ui/settings.test.tsx`:
```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { SettingsView } from '../../src/app/(app)/settings/page'

describe('SettingsView', () => {
  it('shows nothing for a helper role', () => {
    render(<SettingsView role="helper" orgId={1} seeds={[]} />)
    expect(screen.queryByText(/crawl keywords/i)).toBeNull()
  })

  it('shows the keyword list and add form for an owner', () => {
    render(
      <SettingsView
        role="owner"
        orgId={1}
        seeds={[{ id: 1, keyword: 'brussels', enabled: true }]}
      />
    )
    expect(screen.getByText(/crawl keywords/i)).toBeTruthy()
    expect(screen.getByText('brussels')).toBeTruthy()
    expect(screen.getByRole('button', { name: /add/i })).toBeTruthy()
    expect(screen.getByRole('button', { name: /run crawl now/i })).toBeTruthy()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/ui/settings.test.tsx`
Expected: FAIL — `src/app/(app)/settings/page.tsx` does not exist.

- [ ] **Step 3: Implement the Settings page**

`src/app/(app)/settings/page.tsx`:
```tsx
'use client'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useOrg } from '@/lib/hooks/useOrg'

type Seed = { id: number; keyword: string; enabled: boolean }

export function SettingsView({
  role,
  orgId,
  seeds: initialSeeds,
}: {
  role: string
  orgId: number
  seeds: Seed[]
}) {
  const [seeds, setSeeds] = useState(initialSeeds)
  const [newKeyword, setNewKeyword] = useState('')
  const [running, setRunning] = useState(false)

  if (role !== 'owner') return null

  async function addKeyword() {
    if (!newKeyword.trim()) return
    await fetch('/vidi/api/crawl-seeds', {
      method: 'POST',
      body: JSON.stringify({ orgId, keyword: newKeyword.trim() }),
    })
    setSeeds((prev) => {
      const existing = prev.find((s) => s.keyword === newKeyword.trim())
      if (existing) return prev.map((s) => (s.keyword === newKeyword.trim() ? { ...s, enabled: true } : s))
      return [...prev, { id: Date.now(), keyword: newKeyword.trim(), enabled: true }]
    })
    setNewKeyword('')
  }

  async function toggle(keyword: string, enabled: boolean) {
    await fetch('/vidi/api/crawl-seeds', {
      method: 'PATCH',
      body: JSON.stringify({ orgId, keyword, enabled }),
    })
    setSeeds((prev) => prev.map((s) => (s.keyword === keyword ? { ...s, enabled } : s)))
  }

  async function runCrawlNow() {
    setRunning(true)
    try {
      await fetch('/vidi/api/crawl/run', { method: 'POST', body: JSON.stringify({ orgId }) })
      toast.success('Crawl started — it will run in the background.')
    } finally {
      setRunning(false)
    }
  }

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="text-muted-foreground">Manage crawl discovery keywords for this instance.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Crawl Keywords</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <ul className="flex flex-col gap-2">
            {seeds.map((s) => (
              <li key={s.id} className="flex items-center gap-2">
                <Checkbox
                  id={`seed-${s.id}`}
                  checked={s.enabled}
                  onCheckedChange={(checked) => toggle(s.keyword, checked === true)}
                />
                <Label htmlFor={`seed-${s.id}`}>{s.keyword}</Label>
              </li>
            ))}
          </ul>
          <div className="flex items-end gap-2">
            <div className="flex flex-1 flex-col gap-1">
              <Label htmlFor="new-keyword">Add keyword</Label>
              <Input id="new-keyword" value={newKeyword} onChange={(e) => setNewKeyword(e.target.value)} />
            </div>
            <Button onClick={addKeyword}>Add</Button>
          </div>
        </CardContent>
      </Card>

      <Button onClick={runCrawlNow} disabled={running}>
        {running ? 'Starting…' : 'Run crawl now'}
      </Button>
    </div>
  )
}

export default function SettingsPage() {
  const { orgId, role, loading } = useOrg()
  const [seeds, setSeeds] = useState<Seed[]>([])

  useEffect(() => {
    if (orgId && role === 'owner') {
      fetch(`/vidi/api/crawl-seeds?orgId=${orgId}`)
        .then((r) => r.json())
        .then((d) => setSeeds(d.seeds ?? []))
        .catch(() => {})
    }
  }, [orgId, role])

  if (loading || !orgId || !role) return null
  return <SettingsView role={role} orgId={orgId} seeds={seeds} />
}
```

- [ ] **Step 4: Add owner-only nav visibility**

In `src/app/(app)/layout.tsx`, replace:
```ts
const NAV_LINKS = [
  { href: '/search', label: 'Search' },
  { href: '/backlog', label: 'Backlog' },
  { href: '/members', label: 'Members' },
]
```
with:
```ts
const BASE_NAV_LINKS = [
  { href: '/search', label: 'Search' },
  { href: '/backlog', label: 'Backlog' },
  { href: '/members', label: 'Members' },
]
```

Then replace:
```tsx
export default function AppLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const { orgId, isAllowlisted, handle, authenticated, loading, refresh } = useOrg()
```
with:
```tsx
export default function AppLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const { orgId, role, isAllowlisted, handle, authenticated, loading, refresh } = useOrg()
  const navLinks = role === 'owner' ? [...BASE_NAV_LINKS, { href: '/settings', label: 'Settings' }] : BASE_NAV_LINKS
```

Then replace:
```tsx
          <nav className="flex items-center gap-4">
            {NAV_LINKS.map((link) => (
```
with:
```tsx
          <nav className="flex items-center gap-4">
            {navLinks.map((link) => (
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/ui/settings.test.tsx`
Expected: PASS (both cases).

- [ ] **Step 6: Run full suite and tsc**

Run: `npx tsc --noEmit && npm test`
Expected: tsc clean; all tests pass.

- [ ] **Step 7: Commit**

```bash
git add "src/app/(app)/settings/page.tsx" "src/app/(app)/layout.tsx" tests/ui/settings.test.tsx
git commit -m "feat(settings): owner-only Settings page with keyword management and manual crawl trigger"
```

---

## Self-Review

**Spec coverage:**
- Part 1 (live search): text/domain-only scope (Tasks 2–4), disable/clear graph filters (Task 4), 25-cap + non-empty-text guard (Tasks 2–3), server-side merge+dedupe with `indexed` flag (Task 3), enrichment over combined set (Task 3), upsert-on-action for live-only results (Tasks 6–8). ✅
- Part 2 (self-verification crawl): org DIDs merged into verifier crawl list (Task 9), no change needed to name-resolution (already handled by the existing `orgHandle` fallback in the search route). ✅
- Part 3 (Settings page): standalone owner-only page (Task 12), hidden nav for non-owners (Task 12), list/add/toggle keywords (Task 10), re-enable-on-re-add (Task 10), manual crawl trigger fire-and-forget (Task 11), no hard-delete/no locking (accepted YAGNI, no task needed). ✅

**Placeholder scan:** No TBD/TODO; every step has complete code.

**Type consistency:** `LiveActor` (Task 2) used identically in Task 3's route and matches the fields SearchForm/AccountCard expect. `AccountRow`/`upsertAccountRow` (Task 6) signature used identically in Tasks 7 and 8. `Verifier` type unchanged from the existing route. `SearchFilters` (Task 4) gains `liveNetwork` consumed correctly in Task 3's route (read directly off parsed JSON, not the exported type — intentional, since route handlers don't import frontend types). `assertOwner`/`AuthzError` used identically to the existing `src/app/api/members/route.ts` pattern in Tasks 10–12.

**One gap fixed inline:** Task 8's test file existence is uncertain (no prior task confirms `tests/api/backlog.test.ts` exists) — the task's Step 1 now explicitly checks and adapts rather than assuming, consistent with how the original Vidi plan handled this same class of uncertainty for other route tests.
