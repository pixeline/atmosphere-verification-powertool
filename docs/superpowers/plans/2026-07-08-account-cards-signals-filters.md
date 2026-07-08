# Account Card Parity, Verifier Checkmarks, Activity Signals & Filters Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give Backlog cards the same display as Search result cards, replace the "Verified by" text badge with per-verifier colored checkmarks, add followers/following/last-active signals to every account, add a shared-bucket timeframe filter, and add a default-on "exclude already verified by us" filter.

**Architecture:** Two new dependency-free shared helpers (`ACTIVITY_BUCKETS`/bucketing, verifier color hashing). A new `accounts` schema migration (4 columns). The crawler's existing `getProfiles`-based hydration gains two free fields (followers/follows counts); a new `refreshLastActive` phase adds a staleness-bounded per-account `getAuthorFeed` call. `queryBuilder` gains two new filter conditions. The search route resolves the current org's DID only when needed. The backlog route gains the same two-query enrichment pattern (profile join + verifier lookup) the search route already uses. `AccountCard` becomes reusable by both Search (checkbox-driven multi-select) and Backlog (per-card action buttons) via two new optional props.

**Tech Stack:** Next.js App Router, Drizzle ORM/PostgreSQL, `@atproto/api`, shadcn/ui (`@base-ui/react`), Vitest + Testing Library.

## Global Constraints

- `ACTIVITY_BUCKETS` is defined once (`src/lib/activityBuckets.ts`) and imported everywhere a "last active" threshold is needed — the filter and the card display must never define their own separate list.
- Verifier checkmark colors come from a deterministic hash of the verifier DID (`src/lib/verifierColor.ts`) — no new database column, no per-verifier admin configuration.
- "Last active" = timestamp of the account's most recent post (`PostView.indexedAt` from `getAuthorFeed`, NOT the client-supplied `record.createdAt`), refreshed at most once per 7 days per account (`accounts.last_active_checked_at`) to bound crawl cost — `getAuthorFeed` has no multi-actor batch form, unlike `getProfiles`.
- `excludeVerifiedByUs` applies to Search only, not Backlog.
- `activeWithinDays` and the existing `followedByVerified`/`verifiedByAnyOf` filters are structurally local-index-only — all three are disabled and cleared when the "Live network" search scope is selected, matching the existing pattern in `src/components/SearchForm.tsx`.
- No new UI dependency (date library, tooltip library, combobox library) — relative-time bucketing and hover tooltips are hand-rolled/native, matching this project's existing preference for plain implementations over new dependencies for simple needs.

---

### Task 1: Schema migration — activity signal columns

**Files:**
- Modify: `src/db/schema.ts`
- Create: `drizzle/0002_account_activity_signals.sql` (generated — this repo has two prior migrations, `0000_woozy_zodiak.sql` and `0001_trgm_indexes.sql`, so drizzle-kit's sequential numbering makes this the third)

**Interfaces:**
- Produces: `accounts.followersCount: number | null`, `accounts.followsCount: number | null`, `accounts.lastActiveAt: Date | null`, `accounts.lastActiveCheckedAt: Date | null` — consumed by Tasks 4, 5, 6, 8, 9.

- [ ] **Step 1: Add the four columns to the schema**

In `src/db/schema.ts`, replace:
```ts
export const accounts = pgTable('accounts', {
  did: text('did').primaryKey(),
  handle: text('handle').notNull(),
  displayName: text('display_name'),
  description: text('description'),
  avatar: text('avatar'),
  isCustomDomain: boolean('is_custom_domain').notNull().default(false),
  seedSource: text('seed_source'),
  indexedAt: timestamp('indexed_at', { withTimezone: true }).defaultNow(),
}, (t) => ({ handleIdx: index('accounts_handle_idx').on(t.handle) }))
```
with:
```ts
export const accounts = pgTable('accounts', {
  did: text('did').primaryKey(),
  handle: text('handle').notNull(),
  displayName: text('display_name'),
  description: text('description'),
  avatar: text('avatar'),
  isCustomDomain: boolean('is_custom_domain').notNull().default(false),
  seedSource: text('seed_source'),
  indexedAt: timestamp('indexed_at', { withTimezone: true }).defaultNow(),
  followersCount: integer('followers_count'),
  followsCount: integer('follows_count'),
  lastActiveAt: timestamp('last_active_at', { withTimezone: true }),
  lastActiveCheckedAt: timestamp('last_active_checked_at', { withTimezone: true }),
}, (t) => ({ handleIdx: index('accounts_handle_idx').on(t.handle) }))
```

- [ ] **Step 2: Generate the migration**

Run: `DATABASE_URL=postgres://dummy:dummy@localhost:5432/dummy npx drizzle-kit generate --name=account_activity_signals`
Expected: a new file `drizzle/0002_account_activity_signals.sql` is created (verified working in this exact environment — `drizzle-kit generate` diffs `schema.ts` against the stored snapshot in `drizzle/meta/`, it does not need a real database connection; the dummy `DATABASE_URL` only satisfies config validation). Confirm the generated SQL contains exactly four `ALTER TABLE "accounts" ADD COLUMN ...` statements and nothing else.

- [ ] **Step 3: Run tsc**

Run: `npx tsc --noEmit`
Expected: clean (no test changes in this task — no code yet reads/writes the new columns).

- [ ] **Step 4: Commit**

```bash
git add src/db/schema.ts drizzle/
git commit -m "feat(db): add followers/follows/last-active columns to accounts"
```

---

### Task 2: Shared activity-bucket helper

**Files:**
- Create: `src/lib/activityBuckets.ts`
- Test: `tests/lib/activityBuckets.test.ts`

**Interfaces:**
- Produces: `ACTIVITY_BUCKETS: {label: string; days: number}[]` (ordered smallest-to-largest: 7 days, 2 weeks, 1 month, 3 months, 6 months) and `describeLastActive(lastActiveAt: string | Date | null | undefined): string` — consumed by Task 9 (`AccountCard`) and Task 11 (`SearchForm`).

- [ ] **Step 1: Write the failing tests**

`tests/lib/activityBuckets.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { ACTIVITY_BUCKETS, describeLastActive } from '../../src/lib/activityBuckets'

describe('ACTIVITY_BUCKETS', () => {
  it('is ordered smallest to largest with the expected five buckets', () => {
    expect(ACTIVITY_BUCKETS.map((b) => b.days)).toEqual([7, 14, 30, 90, 180])
    expect(ACTIVITY_BUCKETS.map((b) => b.label)).toEqual([
      '7 days', '2 weeks', '1 month', '3 months', '6 months',
    ])
  })
})

describe('describeLastActive', () => {
  it('returns "Activity unknown" for null/undefined', () => {
    expect(describeLastActive(null)).toBe('Activity unknown')
    expect(describeLastActive(undefined)).toBe('Activity unknown')
  })

  it('buckets a timestamp 3 days ago into the 7-day bucket', () => {
    const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString()
    expect(describeLastActive(threeDaysAgo)).toBe('Active within 7 days')
  })

  it('buckets a timestamp exactly 7 days ago into the 7-day bucket (inclusive boundary)', () => {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
    expect(describeLastActive(sevenDaysAgo)).toBe('Active within 7 days')
  })

  it('buckets a timestamp 45 days ago into the 3-month bucket', () => {
    const fortyFiveDaysAgo = new Date(Date.now() - 45 * 24 * 60 * 60 * 1000).toISOString()
    expect(describeLastActive(fortyFiveDaysAgo)).toBe('Active within 3 months')
  })

  it('returns the over-6-months catch-all for anything past the largest bucket', () => {
    const overSixMonths = new Date(Date.now() - 200 * 24 * 60 * 60 * 1000).toISOString()
    expect(describeLastActive(overSixMonths)).toBe('Active over 6 months ago')
  })

  it('accepts a Date instance as well as a string', () => {
    const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000)
    expect(describeLastActive(twoDaysAgo)).toBe('Active within 7 days')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/lib/activityBuckets.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement**

`src/lib/activityBuckets.ts`:
```ts
export type ActivityBucket = { label: string; days: number }

// Ordered smallest-to-largest; both the search filter (SearchForm) and the
// account-card display bucket (AccountCard) import this exact list so they
// can never drift out of sync with each other.
export const ACTIVITY_BUCKETS: ActivityBucket[] = [
  { label: '7 days', days: 7 },
  { label: '2 weeks', days: 14 },
  { label: '1 month', days: 30 },
  { label: '3 months', days: 90 },
  { label: '6 months', days: 180 },
]

export function describeLastActive(lastActiveAt: string | Date | null | undefined): string {
  if (!lastActiveAt) return 'Activity unknown'
  const date = typeof lastActiveAt === 'string' ? new Date(lastActiveAt) : lastActiveAt
  const ageDays = (Date.now() - date.getTime()) / (24 * 60 * 60 * 1000)
  const bucket = ACTIVITY_BUCKETS.find((b) => ageDays <= b.days)
  return bucket ? `Active within ${bucket.label}` : 'Active over 6 months ago'
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/lib/activityBuckets.test.ts`
Expected: PASS (all 8 cases).

- [ ] **Step 5: Run full suite and tsc**

Run: `npx tsc --noEmit && npm test`
Expected: tsc clean; all tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/lib/activityBuckets.ts tests/lib/activityBuckets.test.ts
git commit -m "feat(lib): shared activity-bucket list and last-active describer"
```

---

### Task 3: Verifier color helper

**Files:**
- Create: `src/lib/verifierColor.ts`
- Test: `tests/lib/verifierColor.test.ts`

**Interfaces:**
- Produces: `verifierColorClass(did: string): string` — a Tailwind className string (with `dark:` variant included). Consumed by Task 9 (`AccountCard`).

- [ ] **Step 1: Write the failing tests**

`tests/lib/verifierColor.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { verifierColorClass } from '../../src/lib/verifierColor'

describe('verifierColorClass', () => {
  it('returns the same class for the same DID every time', () => {
    const a = verifierColorClass('did:plc:same')
    const b = verifierColorClass('did:plc:same')
    expect(a).toBe(b)
  })

  it('returns a non-empty className string containing a dark: variant', () => {
    const cls = verifierColorClass('did:plc:example')
    expect(cls.length).toBeGreaterThan(0)
    expect(cls).toContain('dark:')
  })

  it('is likely (not guaranteed) to differ across different DIDs', () => {
    // Not a strict requirement (palette is finite, collisions are expected
    // at scale), but two arbitrary short DIDs should not always collide —
    // this catches an accidental "always return the same class" bug.
    const colors = new Set(
      ['did:plc:aaa', 'did:plc:bbb', 'did:plc:ccc', 'did:plc:ddd', 'did:plc:eee'].map(verifierColorClass)
    )
    expect(colors.size).toBeGreaterThan(1)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/lib/verifierColor.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement**

`src/lib/verifierColor.ts`:
```ts
// 8 colors, each with a dark-mode variant. No database column, no admin
// configuration — the same verifier DID always deterministically hashes to
// the same entry.
const PALETTE = [
  'text-blue-600 dark:text-blue-400',
  'text-emerald-600 dark:text-emerald-400',
  'text-amber-600 dark:text-amber-500',
  'text-rose-600 dark:text-rose-400',
  'text-violet-600 dark:text-violet-400',
  'text-cyan-600 dark:text-cyan-400',
  'text-orange-600 dark:text-orange-400',
  'text-pink-600 dark:text-pink-400',
]

export function verifierColorClass(did: string): string {
  let hash = 0
  for (let i = 0; i < did.length; i++) {
    hash = (hash * 31 + did.charCodeAt(i)) | 0
  }
  return PALETTE[Math.abs(hash) % PALETTE.length]
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/lib/verifierColor.test.ts`
Expected: PASS (all 3 cases).

- [ ] **Step 5: Run full suite and tsc**

Run: `npx tsc --noEmit && npm test`
Expected: tsc clean; all tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/lib/verifierColor.ts tests/lib/verifierColor.test.ts
git commit -m "feat(lib): deterministic per-verifier checkmark color hashing"
```

---

### Task 4: Crawler — populate followers/following counts

**Files:**
- Modify: `src/crawler/hydrate.ts`
- Modify: `src/lib/verify/verifyService.ts`
- Modify: `src/app/api/backlog/route.ts`
- Test: `tests/crawler/hydrate.test.ts`
- Test: `tests/lib/verifyService.test.ts`
- Test: `tests/api/backlog.test.ts`

**Interfaces:**
- Consumes: `accounts.followersCount`/`accounts.followsCount` from Task 1.
- Produces: `AccountRow` gains `followersCount: number | null` and `followsCount: number | null` — every existing construction site of an `AccountRow` object must supply them. `toAccountRow`'s signature/other fields unchanged.

- [ ] **Step 1: Read the current AccountRow constructions**

Run: `grep -n "AccountRow\|upsertAccountRow(" src/crawler/hydrate.ts src/lib/verify/verifyService.ts src/app/api/backlog/route.ts` to confirm the three call sites this task touches (all three already exist from earlier work this session; this step just re-confirms line numbers before editing).

- [ ] **Step 2: Write the failing tests**

Replace `tests/crawler/hydrate.test.ts` in full:
```ts
import { describe, it, expect } from 'vitest'
import { toAccountRow } from '../../src/crawler/hydrate'

describe('toAccountRow', () => {
  it('derives isCustomDomain from handle', () => {
    const row = toAccountRow({ did: 'did:plc:a', handle: 'x.brussels', displayName: 'X', description: 'bio', avatar: 'u' } as any, 'keyword')
    expect(row.isCustomDomain).toBe(true)
    expect(row.seedSource).toBe('keyword')
  })

  it('copies followersCount and followsCount when present', () => {
    const row = toAccountRow({ did: 'did:plc:a', handle: 'x', followersCount: 42, followsCount: 7 } as any, 'crawl')
    expect(row.followersCount).toBe(42)
    expect(row.followsCount).toBe(7)
  })

  it('defaults followersCount and followsCount to null when absent', () => {
    const row = toAccountRow({ did: 'did:plc:a', handle: 'x' } as any, 'crawl')
    expect(row.followersCount).toBeNull()
    expect(row.followsCount).toBeNull()
  })
})
```

In `tests/lib/verifyService.test.ts`, find the existing test `'falls back to the PUBLIC AppView agent getProfile for the handle/displayName when the subject is not in the local accounts index'` (or the nearest equivalent asserting on `calls.inserts`/the accounts upsert from the live-fallback path) and add, in the same test or a new one alongside it:
```ts
it('copies followersCount/followsCount from the live profile into the upserted accounts row', async () => {
  accountsSelectResult = []
  checkGuards.mockResolvedValue({ ok: true })
  publicGetProfile.mockResolvedValue({
    data: { handle: 'newfound.brussels', displayName: 'New', followersCount: 15, followsCount: 3 },
  })
  createRecord.mockResolvedValue({ data: { uri: 'at://did:plc:org/app.bsky.graph.verification/rk1', cid: 'x' } })

  await verifyOne({ org: { id: 1, did: 'did:plc:org' }, actorDid: 'did:plc:member', subject: { did: 'did:plc:newfound2' } })

  const accountsInsert = calls.inserts.find((i) => (i.values as any)?.did === 'did:plc:newfound2')
  expect(accountsInsert).toBeTruthy()
  expect((accountsInsert!.values as any).followersCount).toBe(15)
  expect((accountsInsert!.values as any).followsCount).toBe(3)
})
```
(Adapt to this file's exact existing mock variable names for `accountsSelectResult`, `publicGetProfile`, `checkGuards`, `createRecord`, and the recording `calls` object — read the file first to confirm exact names before writing, per the pattern already used by the surrounding tests in this file.)

In `tests/api/backlog.test.ts`, add a case alongside the existing `'upserts an accounts row (server-resolved identity) when handle hints a live-only, not-yet-indexed result'` test:
```ts
it('copies followersCount/followsCount from the resolved profile into the upserted accounts row', async () => {
  publicGetProfile.mockResolvedValue({
    data: { handle: 'newfound.brussels', displayName: 'New', description: null, avatar: null, followersCount: 8, followsCount: 20 },
  })
  const req = new Request('http://x/vidi/api/backlog', {
    method: 'POST',
    body: JSON.stringify({ orgId: 1, subjectDid: 'did:plc:live2', handle: 'newfound.brussels' }),
  })
  await POST(req as any)
  const accountsInsert = insertedValues.find((v) => 'handle' in v)
  expect(accountsInsert).toBeTruthy()
  expect(accountsInsert!.followersCount).toBe(8)
  expect(accountsInsert!.followsCount).toBe(20)
})
```
(Adapt to this file's exact existing mock variable names — read the file first, per the pattern already used by the surrounding tests.)

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run tests/crawler/hydrate.test.ts tests/lib/verifyService.test.ts tests/api/backlog.test.ts`
Expected: the 5 new/changed cases FAIL (missing fields); pre-existing cases in these files still PASS.

- [ ] **Step 4: Implement**

In `src/crawler/hydrate.ts`, replace:
```ts
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
```
with:
```ts
export type AccountRow = {
  did: string
  handle: string
  displayName: string | null
  description: string | null
  avatar: string | null
  isCustomDomain: boolean
  seedSource: string
  followersCount: number | null
  followsCount: number | null
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
    followersCount: p.followersCount ?? null,
    followsCount: p.followsCount ?? null,
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
        followersCount: row.followersCount,
        followsCount: row.followsCount,
      },
    })
}
```

In `src/lib/verify/verifyService.ts`, in `resolveSubjectIdentity`, replace:
```ts
      await upsertAccountRow({
        did,
        handle: prof.data.handle,
        displayName: prof.data.displayName ?? null,
        description: prof.data.description ?? null,
        avatar: prof.data.avatar ?? null,
        isCustomDomain: isCustomDomain(prof.data.handle),
        seedSource: 'verify-fallback',
      })
```
with:
```ts
      await upsertAccountRow({
        did,
        handle: prof.data.handle,
        displayName: prof.data.displayName ?? null,
        description: prof.data.description ?? null,
        avatar: prof.data.avatar ?? null,
        isCustomDomain: isCustomDomain(prof.data.handle),
        seedSource: 'verify-fallback',
        followersCount: prof.data.followersCount ?? null,
        followsCount: prof.data.followsCount ?? null,
      })
```

In `src/app/api/backlog/route.ts`, in the `POST` handler, replace:
```ts
          await upsertAccountRow({
            did: subjectDid,
            handle: prof.data.handle,
            displayName: prof.data.displayName ?? null,
            description: prof.data.description ?? null,
            avatar: prof.data.avatar ?? null,
            isCustomDomain: isCustomDomain(prof.data.handle),
            seedSource: 'backlog',
          })
```
with:
```ts
          await upsertAccountRow({
            did: subjectDid,
            handle: prof.data.handle,
            displayName: prof.data.displayName ?? null,
            description: prof.data.description ?? null,
            avatar: prof.data.avatar ?? null,
            isCustomDomain: isCustomDomain(prof.data.handle),
            seedSource: 'backlog',
            followersCount: prof.data.followersCount ?? null,
            followsCount: prof.data.followsCount ?? null,
          })
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/crawler/hydrate.test.ts tests/lib/verifyService.test.ts tests/api/backlog.test.ts`
Expected: PASS.

- [ ] **Step 6: Run full suite and tsc**

Run: `npx tsc --noEmit && npm test`
Expected: tsc clean; all tests pass.

- [ ] **Step 7: Commit**

```bash
git add src/crawler/hydrate.ts src/lib/verify/verifyService.ts src/app/api/backlog/route.ts tests/crawler/hydrate.test.ts tests/lib/verifyService.test.ts tests/api/backlog.test.ts
git commit -m "feat(crawler): populate followers/following counts on every account upsert"
```

---

### Task 5: Crawler — refreshLastActive phase

**Files:**
- Create: `src/crawler/refreshLastActive.ts`
- Modify: `src/crawler/run.ts`
- Test: `tests/crawler/refreshLastActive.test.ts`

**Interfaces:**
- Consumes: `AtpAgent` (same shared agent `run.ts` already passes to `hydrateAccounts`/`runKeywordSeed`).
- Produces: `refreshLastActive(agent: AtpAgent): Promise<void>` — no return value consumed by other tasks; `run.ts` calls it as its own try/catch phase.

- [ ] **Step 1: Write the failing tests**

`tests/crawler/refreshLastActive.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const staleRows: { did: string }[] = [{ did: 'did:plc:stale1' }, { did: 'did:plc:stale2' }]
let selectRows = staleRows

vi.mock('../../src/db/client', () => ({
  db: {
    select: () => ({ from: () => ({ where: async () => selectRows }) }),
    update: () => ({
      set: (values: Record<string, unknown>) => ({
        where: async () => {
          updateCalls.push(values)
        },
      }),
    }),
  },
}))

const updateCalls: Record<string, unknown>[] = []

import { refreshLastActive } from '../../src/crawler/refreshLastActive'

beforeEach(() => {
  selectRows = staleRows
  updateCalls.length = 0
})

describe('refreshLastActive', () => {
  it('writes lastActiveAt from the most recent post and stamps lastActiveCheckedAt', async () => {
    const getAuthorFeed = vi.fn(async ({ actor }: { actor: string }) => ({
      data: {
        feed:
          actor === 'did:plc:stale1'
            ? [{ post: { indexedAt: '2026-01-01T00:00:00.000Z' } }]
            : [],
      },
    }))
    const agent = { app: { bsky: { feed: { getAuthorFeed } } } } as any

    await refreshLastActive(agent)

    expect(getAuthorFeed).toHaveBeenCalledTimes(2)
    const withPost = updateCalls.find((c) => c.lastActiveAt instanceof Date && (c.lastActiveAt as Date).toISOString() === '2026-01-01T00:00:00.000Z')
    expect(withPost).toBeTruthy()
    // An account with zero posts still gets stamped (lastActiveAt: null,
    // lastActiveCheckedAt: now) so it isn't re-checked every single crawl.
    const withoutPost = updateCalls.find((c) => c.lastActiveAt === null)
    expect(withoutPost).toBeTruthy()
    expect(updateCalls.every((c) => c.lastActiveCheckedAt instanceof Date)).toBe(true)
  })

  it('isolates a failure fetching one account so the others are still refreshed', async () => {
    const getAuthorFeed = vi.fn(async ({ actor }: { actor: string }) => {
      if (actor === 'did:plc:stale1') throw new Error('boom')
      return { data: { feed: [{ post: { indexedAt: '2026-02-02T00:00:00.000Z' } }] } }
    })
    const agent = { app: { bsky: { feed: { getAuthorFeed } } } } as any

    await refreshLastActive(agent)

    // The failing account is NOT stamped (so it's retried next crawl, not
    // left stale for a full 7 days on a transient failure); the other is.
    expect(updateCalls).toHaveLength(1)
    expect((updateCalls[0].lastActiveAt as Date).toISOString()).toBe('2026-02-02T00:00:00.000Z')
  })

  it('does nothing when there are no stale/unchecked accounts', async () => {
    selectRows = []
    const getAuthorFeed = vi.fn()
    const agent = { app: { bsky: { feed: { getAuthorFeed } } } } as any

    await refreshLastActive(agent)

    expect(getAuthorFeed).not.toHaveBeenCalled()
    expect(updateCalls).toHaveLength(0)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/crawler/refreshLastActive.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement**

`src/crawler/refreshLastActive.ts`:
```ts
import type { AtpAgent } from '@atproto/api'
import { eq, isNull, lt, or } from 'drizzle-orm'
import { db } from '../db/client'
import { accounts } from '../db/schema'

const STALE_AFTER_MS = 7 * 24 * 60 * 60 * 1000

/**
 * Refreshes accounts.lastActiveAt from each account's most recent post.
 * getAuthorFeed has no multi-actor batch form (unlike getProfiles), so this
 * is bounded to accounts whose last_active_checked_at is null or more than
 * 7 days old — re-checking everyone on every crawl would multiply network
 * calls by the account count and risk the public AppView's rate limits.
 */
export async function refreshLastActive(agent: AtpAgent): Promise<void> {
  const staleCutoff = new Date(Date.now() - STALE_AFTER_MS)
  const stale = await db
    .select({ did: accounts.did })
    .from(accounts)
    .where(or(isNull(accounts.lastActiveCheckedAt), lt(accounts.lastActiveCheckedAt, staleCutoff)))

  for (const { did } of stale) {
    try {
      const { data } = await agent.app.bsky.feed.getAuthorFeed({ actor: did, limit: 1 })
      const lastPostIndexedAt = data.feed[0]?.post.indexedAt
      await db
        .update(accounts)
        .set({
          lastActiveAt: lastPostIndexedAt ? new Date(lastPostIndexedAt) : null,
          lastActiveCheckedAt: new Date(),
        })
        .where(eq(accounts.did, did))
    } catch (err) {
      console.error(`refreshLastActive: failed for ${did}`, err)
    }
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/crawler/refreshLastActive.test.ts`
Expected: PASS (all 3 cases).

- [ ] **Step 5: Wire into run.ts**

In `src/crawler/run.ts`, replace:
```ts
import { hydrateAccounts } from './hydrate'
```
with:
```ts
import { hydrateAccounts } from './hydrate'
import { refreshLastActive } from './refreshLastActive'
```

Replace:
```ts
  const allDids = [...new Set([...verifiedSubjects, ...followedMap.keys(), ...keywordDids])]
  try {
    await hydrateAccounts(agent, allDids)
  } catch (err) {
    console.error('runCrawl: hydrateAccounts failed', err)
  }
```
with:
```ts
  const allDids = [...new Set([...verifiedSubjects, ...followedMap.keys(), ...keywordDids])]
  try {
    await hydrateAccounts(agent, allDids)
  } catch (err) {
    console.error('runCrawl: hydrateAccounts failed', err)
  }

  try {
    await refreshLastActive(agent)
  } catch (err) {
    console.error('runCrawl: refreshLastActive failed', err)
  }
```

- [ ] **Step 6: Run full suite and tsc**

Run: `npx tsc --noEmit && npm test`
Expected: tsc clean; all tests pass (this task adds 3 new tests; `run.ts` is orchestration-only, no dedicated test per established precedent — must compile cleanly).

- [ ] **Step 7: Commit**

```bash
git add src/crawler/refreshLastActive.ts src/crawler/run.ts tests/crawler/refreshLastActive.test.ts
git commit -m "feat(crawler): refresh last-active-post timestamp, bounded to stale accounts"
```

---

### Task 6: queryBuilder — activeWithinDays and excludeVerifiedByUs filters

**Files:**
- Modify: `src/lib/search/queryBuilder.ts`
- Test: `tests/lib/queryBuilder.test.ts`

**Interfaces:**
- Consumes: `accounts.lastActiveAt` (Task 1), `accountVerifications` (existing).
- Produces: `SearchFilters` gains `activeWithinDays?: number | null` and `excludeVerifiedByUs?: boolean`. `buildConditions(f: SearchFilters, currentOrgDid?: string | null): SQL[]` and `searchAccounts(f: SearchFilters, currentOrgDid?: string | null, limit = 50)` both gain a new second parameter (default `null`), inserted before the existing `limit` parameter on `searchAccounts` — consumed by Task 7 (`search/route.ts`).

- [ ] **Step 1: Read the current file**

Run: `cat src/lib/search/queryBuilder.ts` to confirm it matches the Step 3 "before" block exactly before editing (this file has not changed since the live-search feature; the plan text and the codebase are expected to match, but confirm before assuming).

- [ ] **Step 2: Write the failing tests**

Replace `tests/lib/queryBuilder.test.ts` in full:
```ts
import { describe, it, expect } from 'vitest'
import { buildConditions } from '../../src/lib/search/queryBuilder'

describe('buildConditions', () => {
  it('produces a condition per active filter', () => {
    const conds = buildConditions({ text: '🇧🇪', customDomainOnly: true, followedByVerified: true })
    expect(conds).toHaveLength(3) // text, customDomain, followedByVerified
  })
  it('is empty when no filters set', () => {
    expect(buildConditions({})).toHaveLength(0)
  })

  it('adds a condition when activeWithinDays is set', () => {
    expect(buildConditions({ activeWithinDays: 30 })).toHaveLength(1)
  })
  it('adds no condition when activeWithinDays is null or absent', () => {
    expect(buildConditions({ activeWithinDays: null })).toHaveLength(0)
    expect(buildConditions({})).toHaveLength(0)
  })

  it('adds a condition when excludeVerifiedByUs is set and a current org DID is provided', () => {
    expect(buildConditions({ excludeVerifiedByUs: true }, 'did:plc:ourorg')).toHaveLength(1)
  })
  it('adds no condition when excludeVerifiedByUs is set but no current org DID is provided', () => {
    expect(buildConditions({ excludeVerifiedByUs: true }, null)).toHaveLength(0)
  })
  it('adds no condition when excludeVerifiedByUs is false, even with a current org DID', () => {
    expect(buildConditions({ excludeVerifiedByUs: false }, 'did:plc:ourorg')).toHaveLength(0)
  })
})
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run tests/lib/queryBuilder.test.ts`
Expected: the 5 new cases FAIL; the 2 pre-existing cases still PASS.

- [ ] **Step 4: Implement**

Replace `src/lib/search/queryBuilder.ts` in full:
```ts
import { and, or, ilike, eq, inArray, exists, notExists, gte, type SQL } from 'drizzle-orm'
import { db } from '../../db/client'
import { accounts, accountVerifications, accountSignals } from '../../db/schema'

export type SearchFilters = {
  text?: string
  customDomainOnly?: boolean
  verifiedByAnyOf?: string[]
  followedByVerified?: boolean
  activeWithinDays?: number | null
  excludeVerifiedByUs?: boolean
}

export function buildConditions(f: SearchFilters, currentOrgDid: string | null = null): SQL[] {
  const conds: SQL[] = []
  if (f.text) {
    const like = `%${f.text}%`
    conds.push(or(ilike(accounts.handle, like), ilike(accounts.description, like))!)
  }
  if (f.customDomainOnly) conds.push(eq(accounts.isCustomDomain, true))
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
  if (f.activeWithinDays) {
    const cutoff = new Date(Date.now() - f.activeWithinDays * 24 * 60 * 60 * 1000)
    conds.push(gte(accounts.lastActiveAt, cutoff))
  }
  if (f.excludeVerifiedByUs && currentOrgDid) {
    conds.push(notExists(
      db.select().from(accountVerifications).where(and(
        eq(accountVerifications.subjectDid, accounts.did),
        eq(accountVerifications.verifierDid, currentOrgDid),
      )),
    ))
  }
  return conds
}

export async function searchAccounts(f: SearchFilters, currentOrgDid: string | null = null, limit = 50) {
  const conds = buildConditions(f, currentOrgDid)
  const q = db.select().from(accounts)
  const rows = conds.length ? await q.where(and(...conds)).limit(limit) : await q.limit(limit)
  return rows
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/lib/queryBuilder.test.ts`
Expected: PASS (all 7 cases).

- [ ] **Step 6: Run full suite and tsc**

Run: `npx tsc --noEmit && npm test`
Expected: tsc clean; all tests pass. (`search/route.ts`'s call site `searchAccounts(filters ?? {})` still compiles — the new parameter has a default — this task does not yet update that call site; Task 7 does.)

- [ ] **Step 7: Commit**

```bash
git add src/lib/search/queryBuilder.ts tests/lib/queryBuilder.test.ts
git commit -m "feat(search): activeWithinDays and excludeVerifiedByUs filter conditions"
```

---

### Task 7: Search route — resolve current org DID for excludeVerifiedByUs

**Files:**
- Modify: `src/app/api/search/route.ts`
- Test: `tests/api/search.test.ts`

**Interfaces:**
- Consumes: `searchAccounts(filters, currentOrgDid)` from Task 6.
- Produces: no change to the route's request/response shape beyond accepting `filters.activeWithinDays`/`filters.excludeVerifiedByUs` (already passed through unchanged inside `filters` — no new top-level field).

- [ ] **Step 1: Read the current file**

Run: `cat src/app/api/search/route.ts` to confirm it matches the Step 3 "before" block before editing.

- [ ] **Step 2: Write the failing tests**

In `tests/api/search.test.ts`, this task changes the `db/client` mock's shape (it must now support a second, different `.from()` target: `orgs`) and the `queryBuilder` mock (it must now record its call arguments so the route's org-DID-resolution can be asserted on). Replace the file's mocks and add new tests — full replacement of `tests/api/search.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../src/lib/authz/membership', () => ({
  assertActiveMember: async () => {},
  AuthzError: class extends Error {
    status = 403
  },
}))

const searchResults = [
  { did: 'did:plc:verified', handle: 'verified.bsky.social' },
  { did: 'did:plc:plain', handle: 'plain.bsky.social' },
]

const searchAccountsCalls: unknown[][] = []
vi.mock('../../src/lib/search/queryBuilder', () => ({
  searchAccounts: async (...args: unknown[]) => {
    searchAccountsCalls.push(args)
    return searchResults
  },
}))

const liveActorsResult: unknown[] = []
vi.mock('../../src/lib/search/liveSearch', () => ({
  searchActorsLive: async (...args: unknown[]) => {
    liveSearchCalls.push(args)
    return liveActorsResult
  },
}))
const liveSearchCalls: unknown[][] = []

// Distinguish the orgs select from the accountVerifications enrichment
// select by a sentinel field on the mocked table object passed to `.from()`
// — same pattern already used in tests/app/orgContext.test.ts.
vi.mock('../../src/db/schema', () => ({
  accountVerifications: { __t: 'accountVerifications' } as any,
  trustedVerifiers: { __t: 'trustedVerifiers' } as any,
  orgs: { __t: 'orgs' } as any,
}))

// verification rows returned by the enrichment query
// (accountVerifications LEFT JOIN trustedVerifiers LEFT JOIN orgs)
let verificationRows: unknown[] = [
  {
    subjectDid: 'did:plc:verified',
    verifierDid: 'did:plc:tv1',
    tvHandle: 'trusted-verifier.bsky.social',
    orgHandle: null,
  },
]
let orgRows: unknown[] = [{ id: 1, did: 'did:plc:ourorg', handle: 'ourorg.example' }]

vi.mock('../../src/db/client', () => ({
  db: {
    select: () => ({
      from: (table: any) => {
        if (table?.__t === 'orgs') return { where: async () => orgRows }
        return {
          leftJoin: () => ({
            leftJoin: () => ({
              where: async () => verificationRows,
            }),
          }),
        }
      },
    }),
  },
}))

describe('search route', () => {
  let getActor: () => Promise<{ did: string } | null>

  beforeEach(async () => {
    vi.resetModules()
    getActor = async () => ({ did: 'did:plc:a' })
    verificationRows = [
      {
        subjectDid: 'did:plc:verified',
        verifierDid: 'did:plc:tv1',
        tvHandle: 'trusted-verifier.bsky.social',
        orgHandle: null,
      },
    ]
    orgRows = [{ id: 1, did: 'did:plc:ourorg', handle: 'ourorg.example' }]
    searchAccountsCalls.length = 0
  })

  it('401 when not logged in', async () => {
    vi.doMock('../../src/lib/authz/session', () => ({ getActor: async () => null }))
    const { POST } = await import('../../src/app/api/search/route')
    const req = new Request('http://x/vidi/api/search', {
      method: 'POST',
      body: JSON.stringify({ orgId: 1, filters: {} }),
    })
    expect((await POST(req as any)).status).toBe(401)
  })

  it('enriches results with a non-empty verifiers array for accounts with a verification row', async () => {
    vi.doMock('../../src/lib/authz/session', () => ({ getActor }))
    const { POST } = await import('../../src/app/api/search/route')
    const req = new Request('http://x/vidi/api/search', {
      method: 'POST',
      body: JSON.stringify({ orgId: 1, filters: {} }),
    })
    const res = await POST(req as any)
    expect(res.status).toBe(200)
    const body = await res.json()
    const verified = body.results.find((r: any) => r.did === 'did:plc:verified')
    expect(verified.verifiers).toEqual([
      { did: 'did:plc:tv1', handle: 'trusted-verifier.bsky.social' },
    ])
  })

  it('returns an empty verifiers array for accounts with no verification row', async () => {
    vi.doMock('../../src/lib/authz/session', () => ({ getActor }))
    const { POST } = await import('../../src/app/api/search/route')
    const req = new Request('http://x/vidi/api/search', {
      method: 'POST',
      body: JSON.stringify({ orgId: 1, filters: {} }),
    })
    const res = await POST(req as any)
    const body = await res.json()
    const plain = body.results.find((r: any) => r.did === 'did:plc:plain')
    expect(plain.verifiers).toEqual([])
  })

  it('falls back to the onboarded org handle when the verifier is not on the trusted verifier list', async () => {
    verificationRows = [
      {
        subjectDid: 'did:plc:verified',
        verifierDid: 'did:plc:self-org',
        tvHandle: null,
        orgHandle: 'atproto-belgium.eurosky.social',
      },
    ]
    vi.doMock('../../src/lib/authz/session', () => ({ getActor }))
    const { POST } = await import('../../src/app/api/search/route')
    const req = new Request('http://x/vidi/api/search', {
      method: 'POST',
      body: JSON.stringify({ orgId: 1, filters: {} }),
    })
    const res = await POST(req as any)
    const body = await res.json()
    const verified = body.results.find((r: any) => r.did === 'did:plc:verified')
    expect(verified.verifiers).toEqual([
      { did: 'did:plc:self-org', handle: 'atproto-belgium.eurosky.social' },
    ])
  })

  it('falls back to the DID string when the verifier is neither a trusted verifier nor an onboarded org', async () => {
    verificationRows = [
      { subjectDid: 'did:plc:verified', verifierDid: 'did:plc:unknown-tv', tvHandle: null, orgHandle: null },
    ]
    vi.doMock('../../src/lib/authz/session', () => ({ getActor }))
    const { POST } = await import('../../src/app/api/search/route')
    const req = new Request('http://x/vidi/api/search', {
      method: 'POST',
      body: JSON.stringify({ orgId: 1, filters: {} }),
    })
    const res = await POST(req as any)
    const body = await res.json()
    const verified = body.results.find((r: any) => r.did === 'did:plc:verified')
    expect(verified.verifiers).toEqual([{ did: 'did:plc:unknown-tv', handle: null }])
  })

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
    const verified = body.results.filter((r: any) => r.did === 'did:plc:verified')
    expect(verified).toHaveLength(1)
    expect(verified[0].indexed).toBe(true)
    const liveOnly = body.results.find((r: any) => r.did === 'did:plc:live-only')
    expect(liveOnly.indexed).toBe(false)
    expect(liveOnly.handle).toBe('newfound.brussels')
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

  it('resolves and passes the current org DID to searchAccounts when excludeVerifiedByUs is set', async () => {
    vi.doMock('../../src/lib/authz/session', () => ({ getActor }))
    const { POST } = await import('../../src/app/api/search/route')
    const req = new Request('http://x/vidi/api/search', {
      method: 'POST',
      body: JSON.stringify({ orgId: 1, filters: { excludeVerifiedByUs: true } }),
    })
    await POST(req as any)
    expect(searchAccountsCalls[0][1]).toBe('did:plc:ourorg')
  })

  it('passes null as the current org DID when excludeVerifiedByUs is not set (no org lookup needed)', async () => {
    vi.doMock('../../src/lib/authz/session', () => ({ getActor }))
    const { POST } = await import('../../src/app/api/search/route')
    const req = new Request('http://x/vidi/api/search', {
      method: 'POST',
      body: JSON.stringify({ orgId: 1, filters: {} }),
    })
    await POST(req as any)
    expect(searchAccountsCalls[0][1]).toBeNull()
  })
})
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run tests/api/search.test.ts`
Expected: the 2 new cases FAIL (route does not yet resolve/pass `currentOrgDid`); confirm the pre-existing cases also now FAIL to compile/run cleanly only due to the mock shape change (not due to a real regression) — this is expected until Step 4 lands, since the mock's `.from()` dispatcher and the `orgs` schema mock are new.

- [ ] **Step 4: Implement**

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

  let currentOrgDid: string | null = null
  if (filters?.excludeVerifiedByUs) {
    const orgRows = await db.select().from(orgs).where(eq(orgs.id, orgId))
    currentOrgDid = orgRows[0]?.did ?? null
  }

  const results = await searchAccounts(filters ?? {}, currentOrgDid)

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

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/api/search.test.ts`
Expected: PASS (all 11 cases).

- [ ] **Step 6: Run full suite and tsc**

Run: `npx tsc --noEmit && npm test`
Expected: tsc clean; all tests pass.

- [ ] **Step 7: Commit**

```bash
git add src/app/api/search/route.ts tests/api/search.test.ts
git commit -m "feat(search): resolve current org DID for the excludeVerifiedByUs filter"
```

---

### Task 8: Backlog route — enrich GET with profile and verifier data

**Files:**
- Modify: `src/app/api/backlog/route.ts`
- Test: `tests/api/backlog.test.ts`

**Interfaces:**
- Consumes: `accounts` columns (Task 1/4), the same `accountVerifications`/`trustedVerifiers`/`orgs` enrichment pattern as `search/route.ts`.
- Produces: `GET /vidi/api/backlog` response items gain `handle`, `displayName`, `description`, `isCustomDomain`, `followersCount`, `followsCount`, `lastActiveAt`, `verifiers: {did, handle}[]` alongside the existing `subjectDid`/`note`. Consumed by Task 10 (Backlog page).

- [ ] **Step 1: Read the current file**

Run: `cat src/app/api/backlog/route.ts` to confirm the current `GET` handler matches the Step 3 "before" block (it has not changed since the security fix earlier this session other than the followers/follows addition from Task 4 of this plan).

- [ ] **Step 2: Write the failing tests**

Add to `tests/api/backlog.test.ts` (this file's existing `db/client` mock only supports the POST tests' `.from(accounts).where()` shape for the is-indexed check; this task extends it to also support `GET`'s two new query shapes). At the top of the file, add a schema mock and extend the `db/client` mock's `.from()` to dispatch by table sentinel — replace the file's existing top-of-file mocks section (everything from the first `vi.mock` through the `import { POST } from ...` line) with:
```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../src/lib/authz/session', () => ({ getActor: async () => ({ did: 'did:plc:a' }) }))
vi.mock('../../src/lib/authz/membership', () => ({
  assertActiveMember: async () => {},
  AuthzError: class extends Error {
    status = 403
  },
}))

const publicGetProfile = vi.fn()
vi.mock('@atproto/api', () => ({
  AtpAgent: class {
    constructor() {
      return { getProfile: publicGetProfile } as any
    }
  },
}))

// Distinguish each table's select by a sentinel field on the mocked table
// object passed to `.from()` — same pattern already used in
// tests/app/orgContext.test.ts and tests/api/search.test.ts.
vi.mock('../../src/db/schema', () => ({
  accounts: { __t: 'accounts' } as any,
  backlogItems: { __t: 'backlogItems' } as any,
  accountVerifications: { __t: 'accountVerifications' } as any,
  trustedVerifiers: { __t: 'trustedVerifiers' } as any,
  orgs: { __t: 'orgs' } as any,
}))

const insertedValues: Record<string, unknown>[] = []
let selectResult: unknown[] = []       // POST's "is this subject already indexed" check
let backlogRows: unknown[] = []        // GET's main enriched query (backlogItems LEFT JOIN accounts)
let verifierRows: unknown[] = []       // GET's verifier enrichment query

vi.mock('../../src/db/client', () => ({
  db: {
    select: () => ({
      from: (table: any) => {
        if (table?.__t === 'backlogItems') {
          return { leftJoin: () => ({ where: async () => backlogRows }) }
        }
        if (table?.__t === 'accountVerifications') {
          return { leftJoin: () => ({ leftJoin: () => ({ where: async () => verifierRows }) }) }
        }
        return { where: async () => selectResult } // accounts
      },
    }),
    insert: () => ({
      values: (values: Record<string, unknown>) => {
        insertedValues.push(values)
        return { onConflictDoUpdate: async () => {} }
      },
    }),
  },
}))

import { GET, POST } from '../../src/app/api/backlog/route'

beforeEach(() => {
  insertedValues.length = 0
  selectResult = []
  backlogRows = []
  verifierRows = []
  publicGetProfile.mockReset()
})
```
Keep every existing `describe('backlog route account upsert', ...)` block and its `it(...)` cases exactly as they are below this point (they only use `selectResult`/`insertedValues`/`publicGetProfile`, all still present) — just also add a new top-level describe block:
```ts
describe('backlog route GET enrichment', () => {
  it('returns profile fields and verifiers alongside subjectDid/note', async () => {
    backlogRows = [
      {
        subjectDid: 'did:plc:queued',
        note: 'check this one',
        handle: 'queued.example',
        displayName: 'Queued Account',
        description: 'a bio',
        isCustomDomain: true,
        followersCount: 10,
        followsCount: 5,
        lastActiveAt: '2026-01-01T00:00:00.000Z',
      },
    ]
    verifierRows = [
      { subjectDid: 'did:plc:queued', verifierDid: 'did:plc:tv1', tvHandle: 'tv.example', orgHandle: null },
    ]
    const req = new Request('http://x/vidi/api/backlog?orgId=1')
    const res = await GET(req as any)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.items).toHaveLength(1)
    expect(body.items[0]).toMatchObject({
      subjectDid: 'did:plc:queued',
      note: 'check this one',
      handle: 'queued.example',
      displayName: 'Queued Account',
      description: 'a bio',
      isCustomDomain: true,
      followersCount: 10,
      followsCount: 5,
      lastActiveAt: '2026-01-01T00:00:00.000Z',
      verifiers: [{ did: 'did:plc:tv1', handle: 'tv.example' }],
    })
  })

  it('returns an empty verifiers array for a queued account with no verification row', async () => {
    backlogRows = [{ subjectDid: 'did:plc:unverified', note: null, handle: 'x.example', displayName: null, description: null, isCustomDomain: false, followersCount: null, followsCount: null, lastActiveAt: null }]
    verifierRows = []
    const req = new Request('http://x/vidi/api/backlog?orgId=1')
    const res = await GET(req as any)
    const body = await res.json()
    expect(body.items[0].verifiers).toEqual([])
  })

  it('returns an empty items array without querying verifiers when the backlog is empty', async () => {
    backlogRows = []
    const req = new Request('http://x/vidi/api/backlog?orgId=1')
    const res = await GET(req as any)
    const body = await res.json()
    expect(body.items).toEqual([])
  })
})
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run tests/api/backlog.test.ts`
Expected: the 3 new GET cases FAIL; the pre-existing POST cases continue to PASS once the mock restructure from Step 2 is in place (the mock changes are additive/table-discriminating, not behavior-changing for the accounts-table path the POST tests use).

- [ ] **Step 4: Implement**

In `src/app/api/backlog/route.ts`, replace the imports and `GET` handler:
```ts
import { NextRequest, NextResponse } from 'next/server'
import { and, eq } from 'drizzle-orm'
import { db } from '../../../db/client'
import { backlogItems } from '../../../db/schema'
```
with:
```ts
import { NextRequest, NextResponse } from 'next/server'
import { and, eq, inArray } from 'drizzle-orm'
import { db } from '../../../db/client'
import { accounts, accountVerifications, backlogItems, orgs, trustedVerifiers } from '../../../db/schema'
```
(keep the rest of the existing import lines — `getActor`, `assertActiveMember`/`AuthzError`, `upsertAccountRow`, `isCustomDomain`, `getPublicAppViewAgent` — unchanged).

Replace:
```ts
export async function GET(req: NextRequest) {
  return guard(async () => {
    const actor = await getActor(); if (!actor) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })
    const orgId = Number(req.nextUrl.searchParams.get('orgId'))
    await assertActiveMember(actor.did, orgId)
    const rows = await db.select().from(backlogItems).where(and(eq(backlogItems.orgId, orgId), eq(backlogItems.status, 'pending')))
    return NextResponse.json({ items: rows })
  })
}
```
with:
```ts
export async function GET(req: NextRequest) {
  return guard(async () => {
    const actor = await getActor(); if (!actor) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })
    const orgId = Number(req.nextUrl.searchParams.get('orgId'))
    await assertActiveMember(actor.did, orgId)

    const rows = await db
      .select({
        subjectDid: backlogItems.subjectDid,
        note: backlogItems.note,
        handle: accounts.handle,
        displayName: accounts.displayName,
        description: accounts.description,
        isCustomDomain: accounts.isCustomDomain,
        followersCount: accounts.followersCount,
        followsCount: accounts.followsCount,
        lastActiveAt: accounts.lastActiveAt,
      })
      .from(backlogItems)
      .leftJoin(accounts, eq(backlogItems.subjectDid, accounts.did))
      .where(and(eq(backlogItems.orgId, orgId), eq(backlogItems.status, 'pending')))

    const dids = rows.map((r) => r.subjectDid)
    const verifiersByDid = new Map<string, { did: string; handle: string | null }[]>()
    if (dids.length) {
      const verifierRows = await db
        .select({
          subjectDid: accountVerifications.subjectDid,
          verifierDid: accountVerifications.verifierDid,
          tvHandle: trustedVerifiers.handle,
          orgHandle: orgs.handle,
        })
        .from(accountVerifications)
        .leftJoin(trustedVerifiers, eq(accountVerifications.verifierDid, trustedVerifiers.did))
        .leftJoin(orgs, eq(accountVerifications.verifierDid, orgs.did))
        .where(inArray(accountVerifications.subjectDid, dids))

      for (const row of verifierRows) {
        const list = verifiersByDid.get(row.subjectDid) ?? []
        list.push({ did: row.verifierDid, handle: row.tvHandle ?? row.orgHandle ?? null })
        verifiersByDid.set(row.subjectDid, list)
      }
    }

    const items = rows.map((r) => ({ ...r, verifiers: verifiersByDid.get(r.subjectDid) ?? [] }))
    return NextResponse.json({ items })
  })
}
```

Leave `POST` and `PATCH` unchanged.

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/api/backlog.test.ts`
Expected: PASS (all cases — pre-existing POST tests plus the 3 new GET tests).

- [ ] **Step 6: Run full suite and tsc**

Run: `npx tsc --noEmit && npm test`
Expected: tsc clean; all tests pass.

- [ ] **Step 7: Commit**

```bash
git add src/app/api/backlog/route.ts tests/api/backlog.test.ts
git commit -m "feat(backlog): enrich GET with profile fields and verifiers"
```

---

### Task 9: AccountCard — checkmarks, signals, optional checkbox/actions

**Files:**
- Modify: `src/components/AccountCard.tsx`
- Test: `tests/ui/accountCard.test.tsx` (new)

**Interfaces:**
- Consumes: `ACTIVITY_BUCKETS`/`describeLastActive` (Task 2), `verifierColorClass` (Task 3).
- Produces: `AccountCard`'s `selected`/`onToggle` become optional (checkbox renders only when `onToggle` is provided); new optional `actions?: React.ReactNode` prop rendered at the end of the card. `Account` type gains `followersCount?: number | null`, `followsCount?: number | null`, `lastActiveAt?: string | null`. Consumed by Task 10 (Backlog page uses the new `actions` prop and omits `selected`/`onToggle`); Search's existing usage (`search/page.tsx`) is unaffected since it already always passes `selected`/`onToggle`.

- [ ] **Step 1: Write the failing tests**

`tests/ui/accountCard.test.tsx`:
```tsx
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { AccountCard } from '../../src/components/AccountCard'

afterEach(cleanup)

const baseAcc = {
  did: 'did:plc:x',
  handle: 'x.bsky.social',
  displayName: 'X Account',
}

describe('AccountCard', () => {
  it('renders a checkbox when onToggle is provided', () => {
    render(<AccountCard acc={baseAcc} selected={false} onToggle={vi.fn()} />)
    expect(screen.getByRole('checkbox')).toBeTruthy()
  })

  it('renders no checkbox when onToggle is omitted', () => {
    render(<AccountCard acc={baseAcc} />)
    expect(screen.queryByRole('checkbox')).toBeNull()
  })

  it('renders the actions slot when provided', () => {
    render(<AccountCard acc={baseAcc} actions={<button>Mark verified</button>} />)
    expect(screen.getByRole('button', { name: /mark verified/i })).toBeTruthy()
  })

  it('renders one checkmark per verifier with the handle as a title tooltip', () => {
    render(
      <AccountCard
        acc={{
          ...baseAcc,
          verifiers: [
            { did: 'did:plc:tv1', handle: 'tv-one.example' },
            { did: 'did:plc:tv2', handle: 'tv-two.example' },
          ],
        }}
      />
    )
    const tv1 = document.querySelector('[title="tv-one.example"]')
    const tv2 = document.querySelector('[title="tv-two.example"]')
    expect(tv1).toBeTruthy()
    expect(tv2).toBeTruthy()
  })

  it('gives different verifiers different color classes (not all identical)', () => {
    render(
      <AccountCard
        acc={{
          ...baseAcc,
          verifiers: [
            { did: 'did:plc:aaa', handle: 'a.example' },
            { did: 'did:plc:bbb', handle: 'b.example' },
          ],
        }}
      />
    )
    const a = document.querySelector('[title="a.example"]')!
    const b = document.querySelector('[title="b.example"]')!
    expect(a.className).not.toBe(b.className)
  })

  it('shows the followers/following/last-active signals line for an indexed account', () => {
    render(
      <AccountCard
        acc={{ ...baseAcc, followersCount: 42, followsCount: 7, lastActiveAt: new Date().toISOString(), indexed: true }}
      />
    )
    expect(screen.getByText(/7 following/i)).toBeTruthy()
    expect(screen.getByText(/42 followers/i)).toBeTruthy()
    expect(screen.getByText(/Active within 7 days/i)).toBeTruthy()
  })

  it('hides the signals line for a live-only, not-yet-indexed result', () => {
    render(<AccountCard acc={{ ...baseAcc, indexed: false }} />)
    expect(screen.queryByText(/following/i)).toBeNull()
    expect(screen.queryByText(/followers/i)).toBeNull()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/ui/accountCard.test.tsx`
Expected: FAIL — current component always requires `onToggle`, has no `actions` prop, no checkmarks, no signals line.

- [ ] **Step 3: Implement**

Replace `src/components/AccountCard.tsx` in full:
```tsx
'use client'

import type { ReactNode } from 'react'
import { Check } from 'lucide-react'
import { Checkbox } from '@/components/ui/checkbox'
import { Badge } from '@/components/ui/badge'
import { Label } from '@/components/ui/label'
import { Card, CardContent } from '@/components/ui/card'
import { verifierColorClass } from '@/lib/verifierColor'
import { describeLastActive } from '@/lib/activityBuckets'

type Verifier = { did: string; handle: string | null }

type Account = {
  did: string
  handle: string
  displayName?: string | null
  description?: string | null
  isCustomDomain?: boolean
  verifiers?: Verifier[]
  indexed?: boolean
  followersCount?: number | null
  followsCount?: number | null
  lastActiveAt?: string | null
}

export function AccountCard({
  acc,
  selected,
  onToggle,
  actions,
}: {
  acc: Account
  selected?: boolean
  onToggle?: () => void
  actions?: ReactNode
}) {
  const verifiers = acc.verifiers ?? []
  const showSignals = acc.indexed !== false
  return (
    <Card className="transition-colors hover:bg-muted/40">
      <CardContent className="flex items-start gap-3">
        {onToggle && (
          <Checkbox
            id={`acc-${acc.did}`}
            checked={selected}
            onCheckedChange={onToggle}
            className="mt-1"
          />
        )}
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <Label htmlFor={onToggle ? `acc-${acc.did}` : undefined} className="flex flex-wrap items-center gap-2">
            <span className="font-semibold">{acc.displayName || acc.handle}</span>
            <span className="text-muted-foreground">@{acc.handle}</span>
            {acc.isCustomDomain && <Badge variant="secondary">custom domain</Badge>}
            {acc.indexed === false && <Badge variant="secondary">Not yet indexed</Badge>}
            {verifiers.map((v) => (
              <Check
                key={v.did}
                className={`size-4 ${verifierColorClass(v.did)}`}
                title={v.handle ?? v.did}
              />
            ))}
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
          {showSignals && (
            <p className="text-xs text-muted-foreground">
              {acc.followsCount ?? 0} following · {acc.followersCount ?? 0} followers ·{' '}
              {describeLastActive(acc.lastActiveAt)}
            </p>
          )}
        </div>
        {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
      </CardContent>
    </Card>
  )
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/ui/accountCard.test.tsx`
Expected: PASS (all 7 cases).

- [ ] **Step 5: Run full suite and tsc**

Run: `npx tsc --noEmit && npm test`
Expected: tsc clean; all tests pass — `search/page.tsx`'s existing usage of `AccountCard` (always passing `selected`/`onToggle`) is source-compatible since those props only became optional, not removed/renamed.

- [ ] **Step 6: Commit**

```bash
git add src/components/AccountCard.tsx tests/ui/accountCard.test.tsx
git commit -m "feat(ui): per-verifier checkmarks, activity signals, optional checkbox/actions on AccountCard"
```

---

### Task 10: Backlog page — use AccountCard

**Files:**
- Modify: `src/app/(app)/backlog/page.tsx`
- Test: `tests/ui/backlogPage.test.tsx` (new)

**Interfaces:**
- Consumes: `AccountCard` with `actions` prop, no `selected`/`onToggle` (Task 9); enriched `GET /vidi/api/backlog` response shape (Task 8).

- [ ] **Step 1: Write the failing tests**

`tests/ui/backlogPage.test.tsx`:
```tsx
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'

vi.mock('@/lib/hooks/useOrg', () => ({ useOrg: () => ({ orgId: 1 }) }))

const toastError = vi.fn()
const toastSuccess = vi.fn()
vi.mock('sonner', () => ({ toast: { error: (...a: unknown[]) => toastError(...a), success: (...a: unknown[]) => toastSuccess(...a) } }))

import BacklogPage from '../../src/app/(app)/backlog/page'

afterEach(cleanup)
beforeEach(() => {
  toastError.mockClear()
  toastSuccess.mockClear()
})

function mockFetch(items: unknown[], patchOk = true) {
  global.fetch = vi.fn((url: string, init?: any) => {
    if (init?.method === 'PATCH') {
      return Promise.resolve({ ok: patchOk, json: async () => ({}) }) as any
    }
    return Promise.resolve({ ok: true, json: async () => ({ items }) }) as any
  }) as any
}

describe('BacklogPage', () => {
  it('renders each item as an AccountCard with handle and Mark verified/Skip actions', async () => {
    mockFetch([
      { subjectDid: 'did:plc:queued', note: 'check', handle: 'queued.example', displayName: 'Queued', verifiers: [] },
    ])
    render(<BacklogPage />)

    await waitFor(() => expect(screen.getByText('queued.example', { exact: false })).toBeTruthy())
    expect(screen.getByRole('button', { name: /mark verified/i })).toBeTruthy()
    expect(screen.getByRole('button', { name: /^skip$/i })).toBeTruthy()
    // AccountCard's own selection checkbox must NOT appear on Backlog cards.
    expect(screen.queryByRole('checkbox')).toBeNull()
  })

  it('removes the card and shows a success toast after marking verified', async () => {
    mockFetch([{ subjectDid: 'did:plc:queued', note: null, handle: 'queued.example', verifiers: [] }])
    render(<BacklogPage />)
    await waitFor(() => expect(screen.getByText('queued.example', { exact: false })).toBeTruthy())

    fireEvent.click(screen.getByRole('button', { name: /mark verified/i }))

    await waitFor(() => expect(toastSuccess).toHaveBeenCalledTimes(1))
    expect(screen.queryByText('queued.example', { exact: false })).toBeNull()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/ui/backlogPage.test.tsx`
Expected: FAIL — current page renders a bare `did:plc:...` string, not `AccountCard`/handle text.

- [ ] **Step 3: Implement**

Replace `src/app/(app)/backlog/page.tsx` in full:
```tsx
'use client'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { useOrg } from '@/lib/hooks/useOrg'
import { Button } from '@/components/ui/button'
import { AccountCard } from '@/components/AccountCard'

type BacklogItem = {
  subjectDid: string
  note?: string | null
  handle?: string
  displayName?: string | null
  description?: string | null
  isCustomDomain?: boolean
  followersCount?: number | null
  followsCount?: number | null
  lastActiveAt?: string | null
  verifiers?: { did: string; handle: string | null }[]
}

export default function BacklogPage() {
  const { orgId } = useOrg()
  const [items, setItems] = useState<BacklogItem[]>([])

  useEffect(() => {
    if (orgId) {
      fetch(`/vidi/api/backlog?orgId=${orgId}`)
        .then((r) => r.json())
        .then((d) => setItems(d.items ?? []))
        .catch(() => {})
    }
  }, [orgId])

  async function act(subjectDid: string, status: string) {
    const res = await fetch('/vidi/api/backlog', {
      method: 'PATCH',
      body: JSON.stringify({ orgId, subjectDid, status }),
    })
    if (!res.ok) {
      toast.error('Could not update backlog item')
      return
    }
    setItems((p) => p.filter((i) => i.subjectDid !== subjectDid))
    toast.success(status === 'verified' ? 'Marked verified' : 'Skipped')
  }

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">To Be Verified</h1>
        <p className="text-muted-foreground">Accounts queued for review before verifying.</p>
      </div>

      {items.length === 0 ? (
        <div className="flex items-center justify-center rounded-xl border border-dashed border-border px-6 py-12 text-center text-sm text-muted-foreground">
          Nothing pending review.
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {items.map((i) => (
            <AccountCard
              key={i.subjectDid}
              acc={{
                did: i.subjectDid,
                handle: i.handle ?? i.subjectDid,
                displayName: i.displayName,
                description: i.note ?? i.description,
                isCustomDomain: i.isCustomDomain,
                followersCount: i.followersCount,
                followsCount: i.followsCount,
                lastActiveAt: i.lastActiveAt,
                verifiers: i.verifiers,
              }}
              actions={
                <>
                  <Button size="sm" onClick={() => act(i.subjectDid, 'verified')}>
                    Mark verified
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => act(i.subjectDid, 'skipped')}>
                    Skip
                  </Button>
                </>
              }
            />
          ))}
        </div>
      )}
    </div>
  )
}
```

Note: `i.note ?? i.description` — the backlog queue's own note (if the person who queued it left one) takes display priority over the account's crawled bio, since the note is specifically why THIS org queued THIS account; falling back to the bio keeps useful context visible when no note was left.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/ui/backlogPage.test.tsx`
Expected: PASS (both cases).

- [ ] **Step 5: Run full suite and tsc**

Run: `npx tsc --noEmit && npm test`
Expected: tsc clean; all tests pass.

- [ ] **Step 6: Commit**

```bash
git add "src/app/(app)/backlog/page.tsx" tests/ui/backlogPage.test.tsx
git commit -m "feat(backlog): render queued accounts as AccountCard like Search results"
```

---

### Task 11: SearchForm — timeframe filter and exclude-verified-by-us checkbox

**Files:**
- Modify: `src/components/SearchForm.tsx`
- Test: `tests/ui/searchForm.test.tsx`

**Interfaces:**
- Consumes: `ACTIVITY_BUCKETS` (Task 2).
- Produces: `SearchFilters` gains `activeWithinDays: number | null` and `excludeVerifiedByUs: boolean` — consumed by `search/page.tsx`'s existing `search(filters)` call (already forwards the whole `SearchFilters` object to `POST /vidi/api/search` unchanged, no edit needed there).

- [ ] **Step 1: Read the current file**

Run: `cat src/components/SearchForm.tsx` to confirm it matches the Step 3 "before" block before editing.

- [ ] **Step 2: Write the failing tests**

Add to `tests/ui/searchForm.test.tsx` (keep every existing `it(...)` case in this file exactly as-is; add these new ones inside the existing `describe('SearchForm', ...)` block):
```tsx
  it('defaults "Hide accounts already verified by us" to checked', () => {
    render(<SearchForm trustedVerifiers={[]} onSearch={vi.fn()} />)
    const checkbox = screen.getByRole('checkbox', { name: /hide accounts already verified by us/i })
    expect(checkbox.getAttribute('aria-checked')).toBe('true')
  })

  it('includes excludeVerifiedByUs and activeWithinDays in the submitted filters', () => {
    const onSearch = vi.fn()
    render(<SearchForm trustedVerifiers={[]} onSearch={onSearch} />)
    fireEvent.click(screen.getByRole('button', { name: /^search$/i }))
    expect(onSearch).toHaveBeenCalledWith(
      expect.objectContaining({ excludeVerifiedByUs: true, activeWithinDays: null })
    )
  })

  it('selects an activity bucket and includes it in submitted filters', () => {
    const onSearch = vi.fn()
    render(<SearchForm trustedVerifiers={[]} onSearch={onSearch} />)
    fireEvent.click(screen.getByRole('button', { name: /^1 month$/i }))
    fireEvent.click(screen.getByRole('button', { name: /^search$/i }))
    expect(onSearch).toHaveBeenCalledWith(expect.objectContaining({ activeWithinDays: 30 }))
  })

  it('disables and clears the activity-timeframe control when the live network scope is selected', () => {
    render(<SearchForm trustedVerifiers={[]} onSearch={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: /^1 month$/i }))
    fireEvent.click(screen.getByRole('button', { name: /^live network$/i }))

    const oneMonth = screen.getByRole('button', { name: /^1 month$/i }) as HTMLButtonElement
    expect(oneMonth.getAttribute('aria-pressed')).toBe('false')
    // A plain (non-composite) Button's `disabled` prop renders the native
    // `disabled` attribute, not `aria-disabled` — confirmed by direct probe
    // against this project's Button component; `aria-disabled` only applies
    // inside a Composite/Toolbar context, which this segmented group is not.
    expect(oneMonth.disabled).toBe(true)
    const anyTime = screen.getByRole('button', { name: /^any time$/i })
    expect(anyTime.getAttribute('aria-pressed')).toBe('true')
  })
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run tests/ui/searchForm.test.tsx`
Expected: the 4 new cases FAIL; every pre-existing case still PASSES (this task is purely additive to the form).

- [ ] **Step 4: Implement**

In `src/components/SearchForm.tsx`, replace:
```ts
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

type TV = { did: string; handle: string }

export type SearchFilters = {
  text: string
  customDomainOnly: boolean
  followedByVerified: boolean
  verifiedByAnyOf: string[]
  liveNetwork: boolean
}
```
with:
```ts
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ACTIVITY_BUCKETS } from '@/lib/activityBuckets'

type TV = { did: string; handle: string }

export type SearchFilters = {
  text: string
  customDomainOnly: boolean
  followedByVerified: boolean
  verifiedByAnyOf: string[]
  liveNetwork: boolean
  activeWithinDays: number | null
  excludeVerifiedByUs: boolean
}
```

Replace:
```ts
  const [liveNetwork, setLiveNetwork] = useState(false)

  function setScope(live: boolean) {
    setLiveNetwork(live)
    if (live) {
      setFollowedByVerified(false)
      setVerifiedByAnyOf([])
    }
  }
```
with:
```ts
  const [liveNetwork, setLiveNetwork] = useState(false)
  const [activeWithinDays, setActiveWithinDays] = useState<number | null>(null)
  const [excludeVerifiedByUs, setExcludeVerifiedByUs] = useState(true)

  function setScope(live: boolean) {
    setLiveNetwork(live)
    if (live) {
      setFollowedByVerified(false)
      setVerifiedByAnyOf([])
      setActiveWithinDays(null)
    }
  }
```

Replace:
```ts
            onSearch({ text, customDomainOnly, followedByVerified, verifiedByAnyOf, liveNetwork })
```
with:
```ts
            onSearch({
              text,
              customDomainOnly,
              followedByVerified,
              verifiedByAnyOf,
              liveNetwork,
              activeWithinDays,
              excludeVerifiedByUs,
            })
```

Replace:
```ts
              Only domain handles (e.g. lalibre.be)
            </Label>
            <Label className="flex items-center gap-2">
              <Checkbox
                id="search-followed-by-verified"
```
with:
```ts
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
            <Label className="flex items-center gap-2">
              <Checkbox
                id="search-followed-by-verified"
```

Replace:
```tsx
          <div className="flex flex-col gap-2">
            <Label>Search in</Label>
            <div role="group" aria-label="Search scope" className="inline-flex w-fit gap-1 rounded-lg border border-border p-1">
```
with:
```tsx
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
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/ui/searchForm.test.tsx`
Expected: PASS (all cases — pre-existing plus the 4 new ones).

- [ ] **Step 6: Run full suite and tsc**

Run: `npx tsc --noEmit && npm test`
Expected: tsc clean; all tests pass.

- [ ] **Step 7: Commit**

```bash
git add src/components/SearchForm.tsx tests/ui/searchForm.test.tsx
git commit -m "feat(search): activity-timeframe filter and default-on exclude-verified-by-us"
```

---

### Task 12: search/page.tsx — Account type gains signal fields

**Files:**
- Modify: `src/app/(app)/search/page.tsx`

**Interfaces:**
- Consumes: enriched `POST /vidi/api/search` response fields from Task 7/6 (`followersCount`, `followsCount`, `lastActiveAt` already flow through automatically once `queryBuilder`'s `db.select().from(accounts)` picks up the new columns — no route change needed for this specific pass-through, confirmed in Task 7's route body which spreads `...r` from `combined` unchanged).

- [ ] **Step 1: Read the current file**

Run: `grep -n "type Account" "src/app/(app)/search/page.tsx"` to confirm the current `Account` type location before editing.

- [ ] **Step 2: Update the type (no test needed — this is a type-only change with no new runtime behavior; `AccountCard` already renders these fields per Task 9, and Task 9's own tests cover that rendering)**

Replace:
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
  followersCount?: number | null
  followsCount?: number | null
  lastActiveAt?: string | null
}
```

- [ ] **Step 3: Run full suite and tsc**

Run: `npx tsc --noEmit && npm test`
Expected: tsc clean; all tests pass (this is a type-widening change only — no existing code narrows `Account` in a way that would break, since all new fields are optional).

- [ ] **Step 4: Commit**

```bash
git add "src/app/(app)/search/page.tsx"
git commit -m "chore(search): widen Account type with the new activity signal fields"
```

---

## Self-Review

**Spec coverage:**
- Part 1 (Backlog card parity): Task 8 (route enrichment) + Task 10 (page uses `AccountCard`). ✅
- Part 2 (verifier checkmarks): Task 3 (color helper) + Task 9 (`AccountCard` renders checkmarks). ✅
- Part 3 (activity signals): Task 1 (columns) + Task 4 (followers/follows, 3 call sites) + Task 5 (`refreshLastActive`, 7-day staleness bound) + Task 2 (shared bucket display helper) + Task 9 (card renders the signals line, hidden for live-only results). ✅
- Part 4 (timeframe filter): Task 2 (shared `ACTIVITY_BUCKETS`) + Task 6 (`queryBuilder`) + Task 11 (`SearchForm` UI, disabled/cleared with live-network scope). ✅
- Part 5 (exclude-verified-by-us, default on, Search only): Task 6 (`queryBuilder`) + Task 7 (route resolves org DID) + Task 11 (`SearchForm` checkbox, default checked). Not applied to Backlog — confirmed, Task 8/10 do not touch this filter. ✅

**Placeholder scan:** No TBD/TODO; every step has complete code.

**Type consistency:** `AccountRow` (Task 4) gains `followersCount`/`followsCount`, consumed identically by all three construction sites (`hydrate.ts`, `verifyService.ts`, `backlog/route.ts`). `SearchFilters` (Task 11) fields (`activeWithinDays`, `excludeVerifiedByUs`) match `queryBuilder.SearchFilters` (Task 6) exactly. `searchAccounts`'s new `currentOrgDid` parameter (Task 6) is threaded through by `search/route.ts` (Task 7) with the same name and position. `AccountCard`'s `Account` type (Task 9) and `search/page.tsx`'s `Account` type (Task 12) and `BacklogPage`'s `BacklogItem` type (Task 10) all use the same field names (`followersCount`, `followsCount`, `lastActiveAt`) for the same concepts.

**One gap fixed inline during authoring:** Task 8's GET enrichment duplicates the verifier-lookup query pattern already present in Task 7's search route rather than extracting a shared helper. This is a deliberate, accepted YAGNI (see below) — flagging it here rather than silently introducing inconsistent duplication-avoidance partway through the plan.

## Out of scope / YAGNI

- No shared `fetchVerifiersByDid` helper extracted from the now-two call sites (search route, backlog route) — each route's enrichment query is independently simple and independently tested; extracting a shared helper mid-plan would require rewriting `search.test.ts`'s already-passing verifier-enrichment tests to mock the new module instead of `db` directly, for a two-call-site DRY win that isn't yet causing real duplication pain. Worth revisiting if a third call site appears.
- No manual "refresh last-active now" trigger — rides the existing crawl schedule/manual-trigger.
- No configurable staleness window (hardcoded 7 days).
- No color-picker/admin control over verifier checkmark colors.
- No "last active" signal for live-network (not-yet-indexed) results.
- No date-range picker — timeframe filter is fixed presets only (`ACTIVITY_BUCKETS`).
