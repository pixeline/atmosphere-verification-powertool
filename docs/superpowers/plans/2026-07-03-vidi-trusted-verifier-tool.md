# Vidi — Trusted Verifier Powertool Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build Vidi — a multi-tenant web tool where allowlisted Mu Trusted Verifiers search accounts by rich criteria and verify/revoke them on Mu (directly or via a shared backlog), with delegated helpers acting as the org under a full audit trail.

**Architecture:** A TypeScript Next.js app (App Router, `basePath: '/vidi'`) plus a crawler worker, both backed by PostgreSQL, deployed on the pixeline VPS via Docker Compose behind Caddy at `https://belgium-atmosphe.re/vidi`. Verification is a standard atproto `app.bsky.graph.verification` record written **as the org** via a stored, encrypted OAuth session; the logged-in human is only ever the "actor" for authz + audit.

**Tech Stack:** Next.js 15 + React + TypeScript · `@atproto/api` · `@atproto/oauth-client-node` · PostgreSQL + Drizzle ORM · `node-cron` · Vitest · Docker Compose + Caddy · GitHub Actions + GHCR.

## Global Constraints

- Product/name: **Vidi**. Code/DNS/package identifiers use lowercase `vidi`.
- Public base URL: `https://belgium-atmosphe.re/vidi` — Next.js `basePath: '/vidi'`, `assetPrefix` matching.
- OAuth `client_id`: `https://belgium-atmosphe.re/vidi/client-metadata.json` (must be HTTPS, stable).
- OAuth scopes requested for the **org**: `atproto transition:generic`.
- Verification lexicon: `app.bsky.graph.verification` (record fields: `subject` DID, `handle`, `displayName`, `createdAt`).
- **Actor vs writer**: every org write is performed via the stored org OAuth session but attributed to the acting member's DID in `verification_actions`.
- Org refresh tokens are **encrypted at rest**; encryption key from env `VIDI_TOKEN_ENC_KEY` (32-byte base64), never stored in DB plaintext.
- Access gating: only DIDs enabled in `trusted_verifier_allowlist` may onboard an org. Superadmin DIDs from env `VIDI_SUPERADMIN_DIDS` (comma-separated).
- Helpers can verify + curate; **cannot** invite. Owners can invite/revoke helpers in their own org.
- Runtime secrets live in `.env` on the VPS, never in the repo or CI.
- DRY, YAGNI, TDD, frequent commits. All new logic is test-first with Vitest.

---

## File Structure

```
docker-compose.yml            # app, worker, db, caddy services
Dockerfile                    # multi-stage Node build for app + worker
Caddyfile                     # routes belgium-atmosphe.re/vidi* -> app:3000, TLS
.github/workflows/deploy.yml  # build -> GHCR -> ssh deploy -> migrate
.env.example                  # documents all runtime secrets
next.config.mjs               # basePath '/vidi'
drizzle.config.ts             # migration config
vitest.config.ts
package.json

src/
  db/
    schema.ts                 # all Drizzle tables
    client.ts                 # pg Pool + drizzle instance
    migrate.ts                # runs migrations on boot/CI
  lib/
    crypto/tokenCrypto.ts     # AES-256-GCM envelope encrypt/decrypt
    atproto/oauthClient.ts    # NodeOAuthClient + Postgres state/session stores
    atproto/stores.ts         # StateStore + SessionStore backed by Postgres (encrypted)
    atproto/orgAgent.ts       # restore org session -> Agent for writes
    domain/handleClassifier.ts# isCustomDomain(handle)
    search/queryBuilder.ts    # filters -> Drizzle query
    verify/guardrails.ts      # dedupe + denylist checks
    verify/verifyService.ts   # createRecord/deleteRecord as org + audit
    authz/session.ts          # actor cookie session (iron-session)
    authz/membership.ts       # resolve actor -> {orgId, role} ; assertions
    allowlist.ts              # allowlist + superadmin helpers
    denylist.ts               # VERIFICATION_DENYLIST_DIDS
  crawler/
    run.ts                    # orchestrates a crawl run
    scheduler.ts              # node-cron entrypoint (worker process)
    trustedVerifiers.ts       # resolve TRUSTED_VERIFIER_LIST_URIS -> DIDs
    verificationsCrawl.ts     # listRecords app.bsky.graph.verification per TV
    followsCrawl.ts           # backwards "followed by verified" signal
    keywordSeed.ts            # searchActors for configured seeds
    hydrate.ts                # getProfiles batch -> accounts
  app/
    layout.tsx  page.tsx
    client-metadata.json/route.ts
    api/auth/login/route.ts  callback/route.ts  logout/route.ts
    api/org/onboard/route.ts
    api/admin/allowlist/route.ts
    api/members/route.ts
    api/search/route.ts
    api/verify/route.ts
    api/revoke/route.ts
    api/backlog/route.ts
    (ui) search/page.tsx  backlog/page.tsx  members/page.tsx

tests/                        # mirrors src/ ; Vitest
```

---

## Phase 0 — Foundation & deployable skeleton

### Task 0.1: Scaffold Next.js + TypeScript + Vitest

**Files:**
- Create: `package.json`, `next.config.mjs`, `tsconfig.json`, `vitest.config.ts`, `src/app/layout.tsx`, `src/app/page.tsx`, `src/app/api/health/route.ts`
- Test: `tests/health.test.ts`

**Interfaces:**
- Produces: `GET /vidi/api/health` → `{ status: "ok" }`.

- [ ] **Step 1: Scaffold app non-interactively**

```bash
npx create-next-app@latest . --ts --app --no-tailwind --no-src-dir --eslint --use-npm --yes
# then move app dir under src for the structure above:
mkdir -p src && git mv app src/app 2>/dev/null || mv app src/app
npm i -D vitest @vitest/coverage-v8
```

- [ ] **Step 2: Configure basePath**

`next.config.mjs`:
```js
/** @type {import('next').NextConfig} */
const nextConfig = { basePath: '/vidi', assetPrefix: '/vidi', output: 'standalone' }
export default nextConfig
```

- [ ] **Step 3: Add Vitest config**

`vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config'
export default defineConfig({ test: { environment: 'node', include: ['tests/**/*.test.ts'] } })
```
Add to `package.json` scripts: `"test": "vitest run"`, `"test:watch": "vitest"`.

- [ ] **Step 4: Write failing health test**

`tests/health.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { GET } from '../src/app/api/health/route'

describe('health', () => {
  it('returns ok', async () => {
    const res = await GET()
    expect(await res.json()).toEqual({ status: 'ok' })
  })
})
```

- [ ] **Step 5: Run test, verify it fails**

Run: `npm test`
Expected: FAIL — cannot resolve `../src/app/api/health/route`.

- [ ] **Step 6: Implement health route**

`src/app/api/health/route.ts`:
```ts
import { NextResponse } from 'next/server'
export function GET() {
  return NextResponse.json({ status: 'ok' })
}
```

- [ ] **Step 7: Run test, verify pass**

Run: `npm test` → Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add -A && git commit -m "chore: scaffold Next.js app with basePath /vidi and health check"
```

### Task 0.2: Docker Compose + Dockerfile + Caddy

**Files:**
- Create: `Dockerfile`, `docker-compose.yml`, `Caddyfile`, `.env.example`, `.dockerignore`

**Interfaces:**
- Produces: `docker compose up` serving the app at `http://localhost/vidi/api/health` through Caddy; `db` (Postgres 16) with a named volume.

- [ ] **Step 1: Dockerfile (multi-stage, standalone output)**

`Dockerfile`:
```dockerfile
FROM node:24-alpine AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci
FROM node:24-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build
FROM node:24-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public
EXPOSE 3000
CMD ["node", "server.js"]
```

- [ ] **Step 2: docker-compose.yml**

```yaml
services:
  app:
    image: ghcr.io/pixeline/vidi:latest
    env_file: .env
    depends_on: [db]
    restart: unless-stopped
  worker:
    image: ghcr.io/pixeline/vidi:latest
    command: ["node", "dist/crawler/scheduler.js"]
    env_file: .env
    depends_on: [db]
    restart: unless-stopped
  db:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: vidi
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
      POSTGRES_DB: vidi
    volumes: [vidi_pg:/var/lib/postgresql/data]
    restart: unless-stopped
  caddy:
    image: caddy:2-alpine
    ports: ["80:80", "443:443"]
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile
      - caddy_data:/data
    depends_on: [app]
    restart: unless-stopped
volumes: { vidi_pg: {}, caddy_data: {} }
```

- [ ] **Step 3: Caddyfile (subpath routing)**

```
belgium-atmosphe.re {
    handle /vidi* {
        reverse_proxy app:3000
    }
}
```

- [ ] **Step 4: .env.example**

```
POSTGRES_PASSWORD=changeme
DATABASE_URL=postgres://vidi:changeme@db:5432/vidi
VIDI_PUBLIC_URL=https://belgium-atmosphe.re/vidi
VIDI_TOKEN_ENC_KEY=<32-byte base64>
VIDI_COOKIE_SECRET=<32+ char secret>
VIDI_SUPERADMIN_DIDS=did:plc:xxxx
TRUSTED_VERIFIER_LIST_URIS=at://did:plc:.../app.bsky.graph.list/...
```

- [ ] **Step 5: Verify skeleton boots**

Run: `docker compose build && docker compose up -d && curl -s http://localhost/vidi/api/health`
Expected: `{"status":"ok"}` (local test may use a `localhost` Caddy block; production uses the real domain).

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "chore: docker compose (app/worker/db/caddy) with subpath routing"
```

### Task 0.3: GitHub Actions deploy pipeline

**Files:**
- Create: `.github/workflows/deploy.yml`

**Interfaces:**
- Produces: on push to `main` → build image, push to GHCR, SSH deploy, run migrations.

- [ ] **Step 1: Workflow file**

`.github/workflows/deploy.yml`:
```yaml
name: deploy
on: { push: { branches: [main] } }
jobs:
  build-deploy:
    runs-on: ubuntu-latest
    permissions: { contents: read, packages: write }
    steps:
      - uses: actions/checkout@v4
      - uses: docker/login-action@v3
        with: { registry: ghcr.io, username: ${{ github.actor }}, password: ${{ secrets.GITHUB_TOKEN }} }
      - uses: docker/build-push-action@v6
        with: { push: true, tags: ghcr.io/pixeline/vidi:latest }
      - name: Deploy over SSH
        uses: appleboy/ssh-action@v1
        with:
          host: ${{ secrets.VPS_HOST }}
          username: ${{ secrets.VPS_USER }}
          key: ${{ secrets.VPS_SSH_KEY }}
          script: |
            cd /opt/vidi
            docker compose pull
            docker compose run --rm app node dist/db/migrate.js
            docker compose up -d
```

- [ ] **Step 2: Document required GitHub secrets in README**

Add to `README.md`: `VPS_HOST`, `VPS_USER`, `VPS_SSH_KEY`. Note the `.env` lives at `/opt/vidi/.env` on the VPS.

- [ ] **Step 3: Commit**

```bash
git add -A && git commit -m "ci: GitHub Actions build->GHCR->ssh deploy pipeline"
```

---

## Phase 1 — Database schema & migrations

### Task 1.1: Drizzle setup + schema

**Files:**
- Create: `drizzle.config.ts`, `src/db/client.ts`, `src/db/schema.ts`, `src/db/migrate.ts`
- Test: `tests/db/schema.test.ts`

**Interfaces:**
- Produces: Drizzle table objects `accounts`, `accountVerifications`, `accountSignals`, `trustedVerifiers`, `crawlRuns`, `crawlSeeds`, `trustedVerifierAllowlist`, `orgs`, `members`, `backlogItems`, `verificationActions`, `oauthState`, `oauthSession`; `db` instance; `runMigrations()`.

- [ ] **Step 1: Install deps**

```bash
npm i drizzle-orm pg
npm i -D drizzle-kit @types/pg
```

- [ ] **Step 2: drizzle.config.ts**

```ts
import { defineConfig } from 'drizzle-kit'
export default defineConfig({
  schema: './src/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: { url: process.env.DATABASE_URL! },
})
```

- [ ] **Step 3: schema.ts (all tables)**

`src/db/schema.ts`:
```ts
import { pgTable, text, boolean, timestamp, serial, integer, uniqueIndex, index, jsonb } from 'drizzle-orm/pg-core'

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

export const accountVerifications = pgTable('account_verifications', {
  subjectDid: text('subject_did').notNull(),
  verifierDid: text('verifier_did').notNull(),
  recordUri: text('record_uri').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }),
}, (t) => ({ uniq: uniqueIndex('av_uniq').on(t.subjectDid, t.verifierDid) }))

export const accountSignals = pgTable('account_signals', {
  subjectDid: text('subject_did').primaryKey(),
  followedByVerified: boolean('followed_by_verified').notNull().default(false),
  verifiedFollowers: jsonb('verified_followers').$type<string[]>().default([]),
})

export const trustedVerifiers = pgTable('trusted_verifiers', {
  did: text('did').primaryKey(),
  handle: text('handle'),
  sourceListUri: text('source_list_uri'),
})

export const trustedVerifierAllowlist = pgTable('trusted_verifier_allowlist', {
  did: text('did').primaryKey(),
  handle: text('handle'),
  enabled: boolean('enabled').notNull().default(true),
  addedBy: text('added_by'),
  addedAt: timestamp('added_at', { withTimezone: true }).defaultNow(),
})

export const orgs = pgTable('orgs', {
  id: serial('id').primaryKey(),
  did: text('did').notNull().unique(),
  handle: text('handle').notNull(),
  scopes: text('scopes'),
  status: text('status').notNull().default('active'),
  onboardedByDid: text('onboarded_by_did'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
})

export const members = pgTable('members', {
  id: serial('id').primaryKey(),
  orgId: integer('org_id').notNull(),
  memberDid: text('member_did').notNull(),
  handle: text('handle'),
  role: text('role').notNull(), // 'owner' | 'helper'
  status: text('status').notNull().default('active'), // 'active' | 'revoked'
  invitedByDid: text('invited_by_did'),
  addedAt: timestamp('added_at', { withTimezone: true }).defaultNow(),
}, (t) => ({ uniq: uniqueIndex('members_uniq').on(t.orgId, t.memberDid) }))

export const backlogItems = pgTable('backlog_items', {
  id: serial('id').primaryKey(),
  orgId: integer('org_id').notNull(),
  subjectDid: text('subject_did').notNull(),
  status: text('status').notNull().default('pending'), // pending|verified|skipped|removed
  addedByDid: text('added_by_did'),
  note: text('note'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
}, (t) => ({ uniq: uniqueIndex('backlog_uniq').on(t.orgId, t.subjectDid) }))

export const verificationActions = pgTable('verification_actions', {
  id: serial('id').primaryKey(),
  orgId: integer('org_id').notNull(),
  actorDid: text('actor_did').notNull(),
  action: text('action').notNull(), // 'verify' | 'revoke'
  subjectDid: text('subject_did').notNull(),
  recordUri: text('record_uri'),
  outcome: text('outcome').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
})

export const crawlRuns = pgTable('crawl_runs', {
  id: serial('id').primaryKey(),
  startedAt: timestamp('started_at', { withTimezone: true }).defaultNow(),
  finishedAt: timestamp('finished_at', { withTimezone: true }),
  stats: jsonb('stats').$type<Record<string, number>>(),
})

export const crawlSeeds = pgTable('crawl_seeds', {
  id: serial('id').primaryKey(),
  keyword: text('keyword').notNull().unique(),
  enabled: boolean('enabled').notNull().default(true),
})

// OAuth persistence (encrypted payloads)
export const oauthState = pgTable('oauth_state', {
  key: text('key').primaryKey(),
  payload: text('payload').notNull(), // encrypted JSON
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
})
export const oauthSession = pgTable('oauth_session', {
  did: text('did').primaryKey(),
  payload: text('payload').notNull(), // encrypted JSON
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
})
```

- [ ] **Step 4: client.ts + migrate.ts**

`src/db/client.ts`:
```ts
import { Pool } from 'pg'
import { drizzle } from 'drizzle-orm/node-postgres'
import * as schema from './schema'
export const pool = new Pool({ connectionString: process.env.DATABASE_URL })
export const db = drizzle(pool, { schema })
```
`src/db/migrate.ts`:
```ts
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { db, pool } from './client'
export async function runMigrations() {
  await migrate(db, { migrationsFolder: './drizzle' })
}
if (require.main === module) {
  runMigrations().then(() => pool.end()).then(() => process.exit(0))
}
```

- [ ] **Step 5: Generate migration + pg_trgm indexes**

```bash
npx drizzle-kit generate
```
Then create `drizzle/9999_trgm.sql` (hand-added, runs with the generated ones):
```sql
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX IF NOT EXISTS accounts_handle_trgm ON accounts USING gin (handle gin_trgm_ops);
CREATE INDEX IF NOT EXISTS accounts_desc_trgm ON accounts USING gin (description gin_trgm_ops);
```

- [ ] **Step 6: Schema smoke test (against a test DB)**

`tests/db/schema.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { accounts, orgs, members } from '../../src/db/schema'
describe('schema', () => {
  it('exposes expected tables', () => {
    expect(accounts).toBeDefined()
    expect(orgs).toBeDefined()
    expect(members).toBeDefined()
  })
})
```

- [ ] **Step 7: Run migration against local db + test**

Run: `docker compose up -d db && DATABASE_URL=postgres://vidi:changeme@localhost:5432/vidi npx tsx src/db/migrate.ts && npm test`
Expected: migration succeeds; tests PASS.

- [ ] **Step 8: Commit**

```bash
git add -A && git commit -m "feat(db): drizzle schema, migrations, pg_trgm indexes"
```

---

## Phase 2 — Crypto & atproto OAuth identity

### Task 2.1: Token encryption (AES-256-GCM)

**Files:**
- Create: `src/lib/crypto/tokenCrypto.ts`
- Test: `tests/lib/tokenCrypto.test.ts`

**Interfaces:**
- Produces: `encryptJson(obj: unknown): string`, `decryptJson<T>(s: string): T`. Key from `VIDI_TOKEN_ENC_KEY` (base64, 32 bytes). Format: base64(`iv(12) | authTag(16) | ciphertext`).

- [ ] **Step 1: Failing round-trip test**

`tests/lib/tokenCrypto.test.ts`:
```ts
import { describe, it, expect, beforeAll } from 'vitest'
import crypto from 'node:crypto'

let encryptJson: any, decryptJson: any
beforeAll(async () => {
  process.env.VIDI_TOKEN_ENC_KEY = crypto.randomBytes(32).toString('base64')
  ;({ encryptJson, decryptJson } = await import('../../src/lib/crypto/tokenCrypto'))
})

describe('tokenCrypto', () => {
  it('round-trips an object', () => {
    const obj = { refresh: 'abc', n: 1 }
    const enc = encryptJson(obj)
    expect(enc).not.toContain('abc')
    expect(decryptJson(enc)).toEqual(obj)
  })
  it('rejects tampered ciphertext', () => {
    const enc = encryptJson({ a: 1 })
    const bad = Buffer.from(enc, 'base64'); bad[bad.length - 1] ^= 0xff
    expect(() => decryptJson(bad.toString('base64'))).toThrow()
  })
})
```

- [ ] **Step 2: Run, verify fail**

Run: `npm test tests/lib/tokenCrypto.test.ts` → FAIL (module missing).

- [ ] **Step 3: Implement**

`src/lib/crypto/tokenCrypto.ts`:
```ts
import crypto from 'node:crypto'

function key(): Buffer {
  const k = Buffer.from(process.env.VIDI_TOKEN_ENC_KEY ?? '', 'base64')
  if (k.length !== 32) throw new Error('VIDI_TOKEN_ENC_KEY must be 32 bytes base64')
  return k
}

export function encryptJson(obj: unknown): string {
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', key(), iv)
  const pt = Buffer.from(JSON.stringify(obj), 'utf8')
  const ct = Buffer.concat([cipher.update(pt), cipher.final()])
  const tag = cipher.getAuthTag()
  return Buffer.concat([iv, tag, ct]).toString('base64')
}

export function decryptJson<T>(s: string): T {
  const buf = Buffer.from(s, 'base64')
  const iv = buf.subarray(0, 12), tag = buf.subarray(12, 28), ct = buf.subarray(28)
  const decipher = crypto.createDecipheriv('aes-256-gcm', key(), iv)
  decipher.setAuthTag(tag)
  const pt = Buffer.concat([decipher.update(ct), decipher.final()])
  return JSON.parse(pt.toString('utf8')) as T
}
```

- [ ] **Step 4: Run, verify pass**

Run: `npm test tests/lib/tokenCrypto.test.ts` → PASS.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(crypto): AES-256-GCM token encryption with tamper detection"
```

### Task 2.2: Postgres-backed encrypted OAuth stores

**Files:**
- Create: `src/lib/atproto/stores.ts`
- Test: `tests/lib/stores.test.ts`

**Interfaces:**
- Consumes: `db`, `oauthState`, `oauthSession`, `encryptJson`/`decryptJson`.
- Produces: `PgStateStore` and `PgSessionStore` implementing `NodeSavedStateStore` / `NodeSavedSessionStore` from `@atproto/oauth-client-node` (`get/set/del`), storing encrypted payloads.

- [ ] **Step 1: Install atproto oauth client**

```bash
npm i @atproto/oauth-client-node @atproto/api jose
```

- [ ] **Step 2: Failing store test (mock db)**

`tests/lib/stores.test.ts`:
```ts
import { describe, it, expect, beforeAll, vi } from 'vitest'
import crypto from 'node:crypto'

const rows = new Map<string, string>()
vi.mock('../../src/db/client', () => ({
  db: {
    insert: () => ({ values: (v: any) => ({ onConflictDoUpdate: async () => { rows.set(v.key ?? v.did, v.payload) } }) }),
    select: () => ({ from: () => ({ where: async () => {
      const only = [...rows.entries()][0]; return only ? [{ payload: only[1] }] : []
    } }) }),
    delete: () => ({ where: async () => { rows.clear() } }),
  },
}))

let PgSessionStore: any
beforeAll(async () => {
  process.env.VIDI_TOKEN_ENC_KEY = crypto.randomBytes(32).toString('base64')
  ;({ PgSessionStore } = await import('../../src/lib/atproto/stores'))
})

describe('PgSessionStore', () => {
  it('encrypts on set and decrypts on get', async () => {
    const store = new PgSessionStore()
    await store.set('did:plc:x', { tokenSet: { refresh_token: 'secret' } } as any)
    expect(rows.get('did:plc:x')).not.toContain('secret')
    const got = await store.get('did:plc:x')
    expect((got as any).tokenSet.refresh_token).toBe('secret')
  })
})
```

- [ ] **Step 3: Run, verify fail** → `npm test tests/lib/stores.test.ts` → FAIL.

- [ ] **Step 4: Implement stores**

`src/lib/atproto/stores.ts`:
```ts
import type { NodeSavedState, NodeSavedStateStore, NodeSavedSession, NodeSavedSessionStore } from '@atproto/oauth-client-node'
import { eq } from 'drizzle-orm'
import { db } from '../../db/client'
import { oauthState, oauthSession } from '../../db/schema'
import { encryptJson, decryptJson } from '../crypto/tokenCrypto'

export class PgStateStore implements NodeSavedStateStore {
  async get(key: string): Promise<NodeSavedState | undefined> {
    const r = await db.select().from(oauthState).where(eq(oauthState.key, key))
    return r[0] ? decryptJson<NodeSavedState>(r[0].payload) : undefined
  }
  async set(key: string, val: NodeSavedState) {
    const payload = encryptJson(val)
    await db.insert(oauthState).values({ key, payload })
      .onConflictDoUpdate({ target: oauthState.key, set: { payload } })
  }
  async del(key: string) { await db.delete(oauthState).where(eq(oauthState.key, key)) }
}

export class PgSessionStore implements NodeSavedSessionStore {
  async get(did: string): Promise<NodeSavedSession | undefined> {
    const r = await db.select().from(oauthSession).where(eq(oauthSession.did, did))
    return r[0] ? decryptJson<NodeSavedSession>(r[0].payload) : undefined
  }
  async set(did: string, val: NodeSavedSession) {
    const payload = encryptJson(val)
    await db.insert(oauthSession).values({ did, payload })
      .onConflictDoUpdate({ target: oauthSession.did, set: { payload } })
  }
  async del(did: string) { await db.delete(oauthSession).where(eq(oauthSession.did, did)) }
}
```

- [ ] **Step 5: Run, verify pass** → PASS.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat(atproto): encrypted Postgres OAuth state/session stores"
```

### Task 2.3: OAuth client + client-metadata route

**Files:**
- Create: `src/lib/atproto/oauthClient.ts`, `src/app/client-metadata.json/route.ts`
- Test: `tests/lib/oauthClient.test.ts`

**Interfaces:**
- Produces: `getOAuthClient(): NodeOAuthClient` (singleton), and `GET /vidi/client-metadata.json` returning the client metadata object with `client_id = ${VIDI_PUBLIC_URL}/client-metadata.json`, `redirect_uris = [${VIDI_PUBLIC_URL}/api/auth/callback]`, `scope = 'atproto transition:generic'`, `grant_types = ['authorization_code','refresh_token']`, `response_types = ['code']`, `application_type = 'web'`, `token_endpoint_auth_method = 'none'`, `dpop_bound_access_tokens = true`.

- [ ] **Step 1: Failing metadata test**

`tests/lib/oauthClient.test.ts`:
```ts
import { describe, it, expect, beforeAll } from 'vitest'
let GET: any
beforeAll(async () => {
  process.env.VIDI_PUBLIC_URL = 'https://belgium-atmosphe.re/vidi'
  ;({ GET } = await import('../../src/app/client-metadata.json/route'))
})
describe('client-metadata', () => {
  it('advertises the correct client_id and scope', async () => {
    const body = await (await GET()).json()
    expect(body.client_id).toBe('https://belgium-atmosphe.re/vidi/client-metadata.json')
    expect(body.redirect_uris).toContain('https://belgium-atmosphe.re/vidi/api/auth/callback')
    expect(body.scope).toBe('atproto transition:generic')
    expect(body.dpop_bound_access_tokens).toBe(true)
  })
})
```

- [ ] **Step 2: Run, verify fail** → FAIL.

- [ ] **Step 3: Implement metadata + client**

`src/lib/atproto/oauthClient.ts`:
```ts
import { NodeOAuthClient } from '@atproto/oauth-client-node'
import { PgStateStore, PgSessionStore } from './stores'

const base = () => process.env.VIDI_PUBLIC_URL!

export function clientMetadata() {
  return {
    client_id: `${base()}/client-metadata.json`,
    client_name: 'Vidi',
    client_uri: base(),
    redirect_uris: [`${base()}/api/auth/callback`],
    scope: 'atproto transition:generic',
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
    application_type: 'web',
    token_endpoint_auth_method: 'none',
    dpop_bound_access_tokens: true,
  } as const
}

let _client: NodeOAuthClient | null = null
export function getOAuthClient(): NodeOAuthClient {
  if (_client) return _client
  _client = new NodeOAuthClient({
    clientMetadata: clientMetadata(),
    stateStore: new PgStateStore(),
    sessionStore: new PgSessionStore(),
  })
  return _client
}
```
`src/app/client-metadata.json/route.ts`:
```ts
import { NextResponse } from 'next/server'
import { clientMetadata } from '../../lib/atproto/oauthClient'
export function GET() {
  return NextResponse.json(clientMetadata())
}
```

- [ ] **Step 4: Run, verify pass** → PASS.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(atproto): OAuth client + /vidi/client-metadata.json"
```

### Task 2.4: Actor login / callback / logout + cookie session

**Files:**
- Create: `src/lib/authz/session.ts`, `src/app/api/auth/login/route.ts`, `src/app/api/auth/callback/route.ts`, `src/app/api/auth/logout/route.ts`
- Test: `tests/lib/session.test.ts`

**Interfaces:**
- Consumes: `getOAuthClient()`.
- Produces: `getActor(req): Promise<{ did: string } | null>` and `setActor`/`clearActor` via `iron-session` (secret `VIDI_COOKIE_SECRET`). `POST /vidi/api/auth/login {handle}` → `{ url }` (authorization URL). `GET /vidi/api/auth/callback` → sets cookie, redirects to `/vidi/search`. `POST /vidi/api/auth/logout` clears cookie.

- [ ] **Step 1: Install session lib**

```bash
npm i iron-session
```

- [ ] **Step 2: Failing session test**

`tests/lib/session.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { sessionOptions } from '../../src/lib/authz/session'
describe('session options', () => {
  it('scopes cookie to /vidi and requires a secret', () => {
    process.env.VIDI_COOKIE_SECRET = 'x'.repeat(32)
    const opts = sessionOptions()
    expect(opts.cookieOptions?.path).toBe('/vidi')
    expect(opts.password).toHaveLength(32)
  })
})
```

- [ ] **Step 3: Run, verify fail** → FAIL.

- [ ] **Step 4: Implement session helper**

`src/lib/authz/session.ts`:
```ts
import { getIronSession, type SessionOptions } from 'iron-session'
import { cookies } from 'next/headers'

export type ActorSession = { did?: string }

export function sessionOptions(): SessionOptions {
  return {
    password: process.env.VIDI_COOKIE_SECRET!,
    cookieName: 'vidi_session',
    cookieOptions: { path: '/vidi', httpOnly: true, secure: true, sameSite: 'lax' },
  }
}
export async function getSession() {
  return getIronSession<ActorSession>(await cookies(), sessionOptions())
}
export async function getActor(): Promise<{ did: string } | null> {
  const s = await getSession()
  return s.did ? { did: s.did } : null
}
```

- [ ] **Step 5: Implement login/callback/logout routes**

`src/app/api/auth/login/route.ts`:
```ts
import { NextRequest, NextResponse } from 'next/server'
import { getOAuthClient } from '../../../lib/atproto/oauthClient'
export async function POST(req: NextRequest) {
  const { handle } = await req.json()
  const url = await getOAuthClient().authorize(handle, { scope: 'atproto transition:generic' })
  return NextResponse.json({ url: url.toString() })
}
```
`src/app/api/auth/callback/route.ts`:
```ts
import { NextRequest, NextResponse } from 'next/server'
import { getOAuthClient } from '../../../lib/atproto/oauthClient'
import { getSession } from '../../../lib/authz/session'
export async function GET(req: NextRequest) {
  const { session } = await getOAuthClient().callback(req.nextUrl.searchParams)
  const s = await getSession()
  s.did = session.did
  await s.save()
  return NextResponse.redirect(`${process.env.VIDI_PUBLIC_URL}/search`)
}
```
`src/app/api/auth/logout/route.ts`:
```ts
import { NextResponse } from 'next/server'
import { getSession } from '../../../lib/authz/session'
export async function POST() {
  const s = await getSession(); s.destroy()
  return NextResponse.json({ ok: true })
}
```

- [ ] **Step 6: Run, verify pass** → `npm test tests/lib/session.test.ts` → PASS.

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "feat(auth): actor OAuth login/callback/logout with iron-session"
```

---

## Phase 3 — Allowlist, org onboarding, membership & authz

### Task 3.1: Allowlist + superadmin helpers

**Files:**
- Create: `src/lib/allowlist.ts`, `src/app/api/admin/allowlist/route.ts`
- Test: `tests/lib/allowlist.test.ts`

**Interfaces:**
- Produces: `isSuperadmin(did): boolean` (from `VIDI_SUPERADMIN_DIDS`), `isAllowlisted(did): Promise<boolean>` (enabled row exists), `addToAllowlist(did, handle, by)`, `POST/GET /vidi/api/admin/allowlist` guarded by `isSuperadmin`.

- [ ] **Step 1: Failing superadmin test**

`tests/lib/allowlist.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { isSuperadmin } from '../../src/lib/allowlist'
describe('isSuperadmin', () => {
  it('matches configured DIDs only', () => {
    process.env.VIDI_SUPERADMIN_DIDS = 'did:plc:a, did:plc:b'
    expect(isSuperadmin('did:plc:a')).toBe(true)
    expect(isSuperadmin('did:plc:z')).toBe(false)
  })
})
```

- [ ] **Step 2: Run, verify fail** → FAIL.

- [ ] **Step 3: Implement**

`src/lib/allowlist.ts`:
```ts
import { and, eq } from 'drizzle-orm'
import { db } from '../db/client'
import { trustedVerifierAllowlist } from '../db/schema'

export function isSuperadmin(did: string): boolean {
  const set = (process.env.VIDI_SUPERADMIN_DIDS ?? '').split(',').map(s => s.trim()).filter(Boolean)
  return set.includes(did)
}
export async function isAllowlisted(did: string): Promise<boolean> {
  const r = await db.select().from(trustedVerifierAllowlist)
    .where(and(eq(trustedVerifierAllowlist.did, did), eq(trustedVerifierAllowlist.enabled, true)))
  return r.length > 0
}
export async function addToAllowlist(did: string, handle: string, by: string) {
  await db.insert(trustedVerifierAllowlist).values({ did, handle, addedBy: by, enabled: true })
    .onConflictDoUpdate({ target: trustedVerifierAllowlist.did, set: { enabled: true, handle } })
}
```
`src/app/api/admin/allowlist/route.ts`:
```ts
import { NextRequest, NextResponse } from 'next/server'
import { getActor } from '../../../lib/authz/session'
import { isSuperadmin, addToAllowlist, isAllowlisted } from '../../../lib/allowlist'
export async function POST(req: NextRequest) {
  const actor = await getActor()
  if (!actor || !isSuperadmin(actor.did)) return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  const { did, handle } = await req.json()
  await addToAllowlist(did, handle, actor.did)
  return NextResponse.json({ ok: true })
}
export async function GET(req: NextRequest) {
  const did = req.nextUrl.searchParams.get('did') ?? ''
  return NextResponse.json({ allowlisted: await isAllowlisted(did) })
}
```

- [ ] **Step 4: Run, verify pass** → PASS.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(allowlist): superadmin-gated trusted-verifier allowlist"
```

### Task 3.2: Org onboarding (store org OAuth session as writer)

**Files:**
- Create: `src/app/api/org/onboard/route.ts`, `src/lib/atproto/orgAgent.ts`
- Test: `tests/lib/orgAgent.test.ts`

**Interfaces:**
- Consumes: `getOAuthClient()`, `isAllowlisted`, `orgs` table, `getActor`.
- Produces: `getOrgAgent(orgDid): Promise<Agent>` (restores stored org OAuth session via `client.restore`). `POST /vidi/api/org/onboard` — actor must be the org account itself (their OAuth `did` === the org DID they onboard) AND allowlisted; upserts `orgs` row + `members` owner row.

> **Note:** Onboarding reuses the *same* OAuth login flow (Task 2.4). The owner logs in **as the org account**; the resulting persisted session IS the writer credential. This route just records the org + owner rows once the org's own DID has an active session.

- [ ] **Step 1: Failing restore test (mock client)**

`tests/lib/orgAgent.test.ts`:
```ts
import { describe, it, expect, vi } from 'vitest'
vi.mock('../../src/lib/atproto/oauthClient', () => ({
  getOAuthClient: () => ({ restore: async (did: string) => ({ did, kind: 'oauth-session' }) }),
}))
import { getOrgAgent } from '../../src/lib/atproto/orgAgent'
describe('getOrgAgent', () => {
  it('restores the org session by did', async () => {
    const agent = await getOrgAgent('did:plc:org')
    expect((agent as any).did).toBe('did:plc:org')
  })
})
```

- [ ] **Step 2: Run, verify fail** → FAIL.

- [ ] **Step 3: Implement orgAgent + onboarding**

`src/lib/atproto/orgAgent.ts`:
```ts
import { Agent } from '@atproto/api'
import { getOAuthClient } from './oauthClient'
export async function getOrgAgent(orgDid: string): Promise<Agent> {
  const session = await getOAuthClient().restore(orgDid)
  return new Agent(session)
}
```
`src/app/api/org/onboard/route.ts`:
```ts
import { NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { db } from '../../../db/client'
import { orgs, members } from '../../../db/schema'
import { getActor } from '../../../lib/authz/session'
import { isAllowlisted } from '../../../lib/allowlist'
import { getOrgAgent } from '../../../lib/atproto/orgAgent'

export async function POST() {
  const actor = await getActor()
  if (!actor) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })
  if (!(await isAllowlisted(actor.did))) return NextResponse.json({ error: 'not_allowlisted' }, { status: 403 })
  // Prove we hold the org writer session (actor logged in as the org account):
  const agent = await getOrgAgent(actor.did)
  const handle = agent.assertDid ? (await agent.getProfile({ actor: actor.did })).data.handle : ''
  const [org] = await db.insert(orgs)
    .values({ did: actor.did, handle, onboardedByDid: actor.did, scopes: 'atproto transition:generic' })
    .onConflictDoUpdate({ target: orgs.did, set: { handle, status: 'active' } })
    .returning()
  await db.insert(members)
    .values({ orgId: org.id, memberDid: actor.did, handle, role: 'owner' })
    .onConflictDoUpdate({ target: [members.orgId, members.memberDid], set: { role: 'owner', status: 'active' } })
  return NextResponse.json({ ok: true, orgId: org.id })
}
```

- [ ] **Step 4: Run, verify pass** → `npm test tests/lib/orgAgent.test.ts` → PASS.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(org): onboarding stores org as writer + owner membership"
```

### Task 3.3: Membership resolution & authz assertions

**Files:**
- Create: `src/lib/authz/membership.ts`
- Test: `tests/lib/membership.test.ts`

**Interfaces:**
- Consumes: `members` table.
- Produces: `getMembership(actorDid, orgId): Promise<{ role: 'owner'|'helper', status: string } | null>`; `assertActiveMember(actorDid, orgId)` (throws `AuthzError` if not active); `assertOwner(actorDid, orgId)` (throws unless active owner). `class AuthzError extends Error { status = 403 }`.

- [ ] **Step 1: Failing authz test (mock db)**

`tests/lib/membership.test.ts`:
```ts
import { describe, it, expect, vi } from 'vitest'
const row = { role: 'helper', status: 'active' }
vi.mock('../../src/db/client', () => ({
  db: { select: () => ({ from: () => ({ where: async () => [row] }) }) },
}))
import { assertActiveMember, assertOwner, AuthzError } from '../../src/lib/authz/membership'
describe('authz', () => {
  it('allows an active member', async () => {
    await expect(assertActiveMember('did:plc:a', 1)).resolves.toBeUndefined()
  })
  it('blocks a helper from owner-only actions', async () => {
    await expect(assertOwner('did:plc:a', 1)).rejects.toBeInstanceOf(AuthzError)
  })
})
```

- [ ] **Step 2: Run, verify fail** → FAIL.

- [ ] **Step 3: Implement**

`src/lib/authz/membership.ts`:
```ts
import { and, eq } from 'drizzle-orm'
import { db } from '../db/client'
import { members } from '../db/schema'

export class AuthzError extends Error { status = 403 }

export async function getMembership(actorDid: string, orgId: number) {
  const r = await db.select().from(members)
    .where(and(eq(members.orgId, orgId), eq(members.memberDid, actorDid)))
  return r[0] ? { role: r[0].role as 'owner' | 'helper', status: r[0].status } : null
}
export async function assertActiveMember(actorDid: string, orgId: number) {
  const m = await getMembership(actorDid, orgId)
  if (!m || m.status !== 'active') throw new AuthzError('not an active member')
}
export async function assertOwner(actorDid: string, orgId: number) {
  const m = await getMembership(actorDid, orgId)
  if (!m || m.status !== 'active' || m.role !== 'owner') throw new AuthzError('owner required')
}
```

- [ ] **Step 4: Run, verify pass** → PASS.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(authz): membership resolution + owner/member assertions"
```

### Task 3.4: Members API (invite / list / revoke)

**Files:**
- Create: `src/app/api/members/route.ts`
- Test: `tests/api/members.test.ts`

**Interfaces:**
- Consumes: `getActor`, `assertOwner`, `members`.
- Produces: `POST /vidi/api/members {orgId, handle, did}` (owner-only invite as helper); `GET /vidi/api/members?orgId` (list active org); `DELETE /vidi/api/members {orgId, memberDid}` (owner-only → set status `revoked`). Helper invites are always `role: 'helper'`.

- [ ] **Step 1: Failing test — helper cannot invite**

`tests/api/members.test.ts`:
```ts
import { describe, it, expect, vi } from 'vitest'
vi.mock('../../src/lib/authz/session', () => ({ getActor: async () => ({ did: 'did:plc:helper' }) }))
vi.mock('../../src/lib/authz/membership', async (orig) => {
  const mod: any = await orig()
  return { ...mod, assertOwner: async () => { throw new mod.AuthzError('owner required') } }
})
import { POST } from '../../src/app/api/members/route'
describe('members invite', () => {
  it('rejects a helper trying to invite', async () => {
    const req = new Request('http://x/vidi/api/members', { method: 'POST', body: JSON.stringify({ orgId: 1, handle: 'x', did: 'did:plc:new' }) })
    const res = await POST(req as any)
    expect(res.status).toBe(403)
  })
})
```

- [ ] **Step 2: Run, verify fail** → FAIL.

- [ ] **Step 3: Implement members route**

`src/app/api/members/route.ts`:
```ts
import { NextRequest, NextResponse } from 'next/server'
import { and, eq } from 'drizzle-orm'
import { db } from '../../db/client'
import { members } from '../../db/schema'
import { getActor } from '../../lib/authz/session'
import { assertOwner, assertActiveMember, AuthzError } from '../../lib/authz/membership'

function guard<T>(fn: () => Promise<T>) {
  return fn().catch((e) => {
    if (e instanceof AuthzError) return NextResponse.json({ error: e.message }, { status: e.status })
    throw e
  })
}

export async function POST(req: NextRequest) {
  return guard(async () => {
    const actor = await getActor(); if (!actor) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })
    const { orgId, handle, did } = await req.json()
    await assertOwner(actor.did, orgId)
    await db.insert(members).values({ orgId, memberDid: did, handle, role: 'helper', invitedByDid: actor.did })
      .onConflictDoUpdate({ target: [members.orgId, members.memberDid], set: { status: 'active', role: 'helper' } })
    return NextResponse.json({ ok: true })
  })
}
export async function GET(req: NextRequest) {
  return guard(async () => {
    const actor = await getActor(); if (!actor) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })
    const orgId = Number(req.nextUrl.searchParams.get('orgId'))
    await assertActiveMember(actor.did, orgId)
    const rows = await db.select().from(members).where(and(eq(members.orgId, orgId), eq(members.status, 'active')))
    return NextResponse.json({ members: rows })
  })
}
export async function DELETE(req: NextRequest) {
  return guard(async () => {
    const actor = await getActor(); if (!actor) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })
    const { orgId, memberDid } = await req.json()
    await assertOwner(actor.did, orgId)
    await db.update(members).set({ status: 'revoked' })
      .where(and(eq(members.orgId, orgId), eq(members.memberDid, memberDid)))
    return NextResponse.json({ ok: true })
  })
}
```

- [ ] **Step 4: Run, verify pass** → PASS.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(members): owner-only invite/revoke, member listing"
```

---

## Phase 4 — Crawler & index

### Task 4.1: Handle classifier (`isCustomDomain`)

**Files:**
- Create: `src/lib/domain/handleClassifier.ts`
- Test: `tests/lib/handleClassifier.test.ts`

**Interfaces:**
- Produces: `isCustomDomain(handle: string): boolean` — `false` if handle ends in a platform suffix (`.bsky.social`, `.mu.social`, `.eurosky.social`), else `true`. `PLATFORM_SUFFIXES: string[]` exported for reuse.

- [ ] **Step 1: Failing test**

`tests/lib/handleClassifier.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { isCustomDomain } from '../../src/lib/domain/handleClassifier'
describe('isCustomDomain', () => {
  it('flags platform handles as non-custom', () => {
    expect(isCustomDomain('alice.bsky.social')).toBe(false)
    expect(isCustomDomain('bob.mu.social')).toBe(false)
    expect(isCustomDomain('x.eurosky.social')).toBe(false)
  })
  it('flags real domains as custom', () => {
    expect(isCustomDomain('france-atmosphe.re')).toBe(true)
    expect(isCustomDomain('jan.brussels')).toBe(true)
  })
})
```

- [ ] **Step 2: Run, verify fail** → FAIL.

- [ ] **Step 3: Implement**

`src/lib/domain/handleClassifier.ts`:
```ts
export const PLATFORM_SUFFIXES = ['.bsky.social', '.mu.social', '.eurosky.social']
export function isCustomDomain(handle: string): boolean {
  const h = handle.toLowerCase()
  return !PLATFORM_SUFFIXES.some((s) => h.endsWith(s))
}
```

- [ ] **Step 4: Run, verify pass** → PASS.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(domain): custom-domain handle classifier"
```

### Task 4.2: Resolve trusted verifiers from lists

**Files:**
- Create: `src/crawler/trustedVerifiers.ts`
- Test: `tests/crawler/trustedVerifiers.test.ts`

**Interfaces:**
- Consumes: an `AppAgent` (unauthenticated `AtpAgent` for public reads), `TRUSTED_VERIFIER_LIST_URIS` (space/comma-separated env), `trustedVerifiers` table.
- Produces: `resolveTrustedVerifierDids(agent, uris: string[]): Promise<string[]>` (dedup DIDs from each list via `app.bsky.graph.getList`); `syncTrustedVerifiers(agent): Promise<string[]>` (resolves env URIs, upserts `trustedVerifiers`).

- [ ] **Step 1: Failing test (mock agent)**

`tests/crawler/trustedVerifiers.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { resolveTrustedVerifierDids } from '../../src/crawler/trustedVerifiers'
const agent = {
  app: { bsky: { graph: { getList: async ({ list }: any) => ({
    data: { items: [{ subject: { did: `did:plc:${list.slice(-1)}1` } }, { subject: { did: `did:plc:${list.slice(-1)}2` } }], cursor: undefined },
  }) } } },
} as any
describe('resolveTrustedVerifierDids', () => {
  it('dedups DIDs across lists', async () => {
    const dids = await resolveTrustedVerifierDids(agent, ['at://l/a', 'at://l/a'])
    expect(dids.sort()).toEqual(['did:plc:a1', 'did:plc:a2'])
  })
})
```

- [ ] **Step 2: Run, verify fail** → FAIL.

- [ ] **Step 3: Implement**

`src/crawler/trustedVerifiers.ts`:
```ts
import type { AtpAgent } from '@atproto/api'
import { db } from '../db/client'
import { trustedVerifiers } from '../db/schema'

export async function resolveTrustedVerifierDids(agent: AtpAgent, uris: string[]): Promise<string[]> {
  const dids = new Set<string>()
  for (const list of uris) {
    let cursor: string | undefined
    do {
      const { data } = await agent.app.bsky.graph.getList({ list, limit: 100, cursor })
      for (const item of data.items) dids.add(item.subject.did)
      cursor = data.cursor
    } while (cursor)
  }
  return [...dids]
}
export async function syncTrustedVerifiers(agent: AtpAgent): Promise<string[]> {
  const uris = (process.env.TRUSTED_VERIFIER_LIST_URIS ?? '').split(/[\s,]+/).filter(Boolean)
  const dids = await resolveTrustedVerifierDids(agent, uris)
  for (const did of dids) {
    await db.insert(trustedVerifiers).values({ did, sourceListUri: uris[0] })
      .onConflictDoNothing()
  }
  return dids
}
```

- [ ] **Step 4: Run, verify pass** → PASS.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(crawler): resolve trusted verifiers from atproto lists"
```

### Task 4.3: Crawl verifications from each TV repo

**Files:**
- Create: `src/crawler/verificationsCrawl.ts`
- Test: `tests/crawler/verificationsCrawl.test.ts`

**Interfaces:**
- Consumes: `AtpAgent`, `accountVerifications` table.
- Produces: `crawlVerifications(agent, verifierDids: string[]): Promise<{subjectDid:string, verifierDid:string, recordUri:string, createdAt?:string}[]>` — for each verifier, `com.atproto.repo.listRecords({repo, collection:'app.bsky.graph.verification'})`, mapping each record's `value.subject` + building `recordUri = at://{verifier}/app.bsky.graph.verification/{rkey}`; upserts into `accountVerifications`.

- [ ] **Step 1: Failing test (mock listRecords)**

`tests/crawler/verificationsCrawl.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { mapVerificationRecords } from '../../src/crawler/verificationsCrawl'
describe('mapVerificationRecords', () => {
  it('maps records to verification edges', () => {
    const edges = mapVerificationRecords('did:plc:tv', [
      { uri: 'at://did:plc:tv/app.bsky.graph.verification/abc', value: { subject: 'did:plc:sub', handle: 'x', displayName: 'X', createdAt: '2026-01-01T00:00:00Z' } },
    ])
    expect(edges[0]).toEqual({ subjectDid: 'did:plc:sub', verifierDid: 'did:plc:tv', recordUri: 'at://did:plc:tv/app.bsky.graph.verification/abc', createdAt: '2026-01-01T00:00:00Z' })
  })
})
```

- [ ] **Step 2: Run, verify fail** → FAIL.

- [ ] **Step 3: Implement**

`src/crawler/verificationsCrawl.ts`:
```ts
import type { AtpAgent } from '@atproto/api'
import { db } from '../db/client'
import { accountVerifications } from '../db/schema'

export type VerificationEdge = { subjectDid: string; verifierDid: string; recordUri: string; createdAt?: string }

export function mapVerificationRecords(verifierDid: string, records: { uri: string; value: any }[]): VerificationEdge[] {
  return records.map((r) => ({
    subjectDid: r.value.subject,
    verifierDid,
    recordUri: r.uri,
    createdAt: r.value.createdAt,
  }))
}

export async function crawlVerifications(agent: AtpAgent, verifierDids: string[]): Promise<VerificationEdge[]> {
  const all: VerificationEdge[] = []
  for (const repo of verifierDids) {
    let cursor: string | undefined
    do {
      const { data } = await agent.com.atproto.repo.listRecords({ repo, collection: 'app.bsky.graph.verification', limit: 100, cursor })
      const edges = mapVerificationRecords(repo, data.records as any)
      all.push(...edges)
      for (const e of edges) {
        await db.insert(accountVerifications)
          .values({ subjectDid: e.subjectDid, verifierDid: e.verifierDid, recordUri: e.recordUri, createdAt: e.createdAt ? new Date(e.createdAt) : undefined })
          .onConflictDoUpdate({ target: [accountVerifications.subjectDid, accountVerifications.verifierDid], set: { recordUri: e.recordUri } })
      }
      cursor = data.cursor
    } while (cursor)
  }
  return all
}
```

- [ ] **Step 4: Run, verify pass** → PASS.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(crawler): crawl app.bsky.graph.verification records per TV"
```

### Task 4.4: Backwards follows signal + keyword seed + hydrate + run orchestration

**Files:**
- Create: `src/crawler/followsCrawl.ts`, `src/crawler/keywordSeed.ts`, `src/crawler/hydrate.ts`, `src/crawler/run.ts`, `src/crawler/scheduler.ts`
- Test: `tests/crawler/followsCrawl.test.ts`, `tests/crawler/hydrate.test.ts`

**Interfaces:**
- Consumes: `AtpAgent`, `accounts`, `accountSignals`, `crawlSeeds`, `crawlRuns`, `isCustomDomain`, `syncTrustedVerifiers`, `crawlVerifications`.
- Produces:
  - `collectFollowedByVerified(agent, verifiedDids: string[]): Promise<Map<string,string[]>>` — for each verified DID, `getFollows`; returns map `followedDid -> [verifiedFollowerDids]`.
  - `runKeywordSeed(agent): Promise<string[]>` — for each enabled `crawlSeeds.keyword`, `searchActors`; returns candidate DIDs.
  - `hydrateAccounts(agent, dids: string[]): Promise<void>` — `getProfiles` in batches of 25; upsert `accounts` with `isCustomDomain`.
  - `runCrawl(): Promise<void>` — orchestrates: new `AtpAgent({service})`, `syncTrustedVerifiers`, `crawlVerifications`, `collectFollowedByVerified` (seed = verifiers ∪ verified subjects), `runKeywordSeed`, `hydrateAccounts` for all discovered DIDs, write `accountSignals`, record `crawlRuns`.
  - `scheduler` — `node-cron` schedule (default `0 3 * * *`, env `VIDI_CRAWL_CRON`) invoking `runCrawl`.

- [ ] **Step 1: Failing follows test (mock getFollows)**

`tests/crawler/followsCrawl.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { collectFollowedByVerified } from '../../src/crawler/followsCrawl'
const agent = {
  getFollows: async ({ actor }: any) => ({ data: { follows: [{ did: 'did:plc:cand' }], cursor: undefined } }),
} as any
describe('collectFollowedByVerified', () => {
  it('maps followed accounts to their verified followers', async () => {
    const map = await collectFollowedByVerified(agent, ['did:plc:v1', 'did:plc:v2'])
    expect(map.get('did:plc:cand')!.sort()).toEqual(['did:plc:v1', 'did:plc:v2'])
  })
})
```

- [ ] **Step 2: Run, verify fail** → FAIL.

- [ ] **Step 3: Implement followsCrawl**

`src/crawler/followsCrawl.ts`:
```ts
import type { AtpAgent } from '@atproto/api'
export async function collectFollowedByVerified(agent: AtpAgent, verifiedDids: string[]): Promise<Map<string, string[]>> {
  const map = new Map<string, string[]>()
  for (const v of verifiedDids) {
    let cursor: string | undefined
    do {
      const { data } = await agent.getFollows({ actor: v, limit: 100, cursor })
      for (const f of data.follows) {
        const arr = map.get(f.did) ?? []
        if (!arr.includes(v)) arr.push(v)
        map.set(f.did, arr)
      }
      cursor = data.cursor
    } while (cursor)
  }
  return map
}
```

- [ ] **Step 4: Failing hydrate test**

`tests/crawler/hydrate.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { toAccountRow } from '../../src/crawler/hydrate'
describe('toAccountRow', () => {
  it('derives isCustomDomain from handle', () => {
    const row = toAccountRow({ did: 'did:plc:a', handle: 'x.brussels', displayName: 'X', description: 'bio', avatar: 'u' } as any, 'keyword')
    expect(row.isCustomDomain).toBe(true)
    expect(row.seedSource).toBe('keyword')
  })
})
```

- [ ] **Step 5: Run, verify fail** → FAIL.

- [ ] **Step 6: Implement hydrate + keywordSeed**

`src/crawler/hydrate.ts`:
```ts
import type { AtpAgent, AppBskyActorDefs } from '@atproto/api'
import { db } from '../db/client'
import { accounts } from '../db/schema'
import { isCustomDomain } from '../lib/domain/handleClassifier'

export function toAccountRow(p: AppBskyActorDefs.ProfileViewDetailed, seedSource: string) {
  return {
    did: p.did, handle: p.handle, displayName: p.displayName ?? null,
    description: p.description ?? null, avatar: p.avatar ?? null,
    isCustomDomain: isCustomDomain(p.handle), seedSource,
  }
}
export async function hydrateAccounts(agent: AtpAgent, dids: string[], seedSource = 'crawl') {
  for (let i = 0; i < dids.length; i += 25) {
    const batch = dids.slice(i, i + 25)
    const { data } = await agent.getProfiles({ actors: batch })
    for (const p of data.profiles) {
      const row = toAccountRow(p, seedSource)
      await db.insert(accounts).values(row)
        .onConflictDoUpdate({ target: accounts.did, set: { handle: row.handle, displayName: row.displayName, description: row.description, avatar: row.avatar, isCustomDomain: row.isCustomDomain } })
    }
  }
}
```
`src/crawler/keywordSeed.ts`:
```ts
import type { AtpAgent } from '@atproto/api'
import { eq } from 'drizzle-orm'
import { db } from '../db/client'
import { crawlSeeds } from '../db/schema'
export async function runKeywordSeed(agent: AtpAgent): Promise<string[]> {
  const seeds = await db.select().from(crawlSeeds).where(eq(crawlSeeds.enabled, true))
  const dids = new Set<string>()
  for (const s of seeds) {
    const { data } = await agent.searchActors({ q: s.keyword, limit: 100 })
    for (const a of data.actors) dids.add(a.did)
  }
  return [...dids]
}
```

- [ ] **Step 7: Implement run + scheduler**

`src/crawler/run.ts`:
```ts
import { AtpAgent } from '@atproto/api'
import { db } from '../db/client'
import { accountSignals, crawlRuns } from '../db/schema'
import { syncTrustedVerifiers } from './trustedVerifiers'
import { crawlVerifications } from './verificationsCrawl'
import { collectFollowedByVerified } from './followsCrawl'
import { runKeywordSeed } from './keywordSeed'
import { hydrateAccounts } from './hydrate'

export async function runCrawl(service = process.env.MU_APPVIEW_URL ?? 'https://mu.social'): Promise<void> {
  const agent = new AtpAgent({ service })
  const [run] = await db.insert(crawlRuns).values({}).returning()
  const verifierDids = await syncTrustedVerifiers(agent)
  const edges = await crawlVerifications(agent, verifierDids)
  const verifiedSubjects = [...new Set(edges.map((e) => e.subjectDid))]
  const seedDids = [...new Set([...verifierDids, ...verifiedSubjects])]
  const followedMap = await collectFollowedByVerified(agent, seedDids)
  const keywordDids = await runKeywordSeed(agent)
  const allDids = [...new Set([...verifiedSubjects, ...followedMap.keys(), ...keywordDids])]
  await hydrateAccounts(agent, allDids)
  for (const [did, verifiedFollowers] of followedMap) {
    await db.insert(accountSignals).values({ subjectDid: did, followedByVerified: true, verifiedFollowers })
      .onConflictDoUpdate({ target: accountSignals.subjectDid, set: { followedByVerified: true, verifiedFollowers } })
  }
  await db.update(crawlRuns).set({ finishedAt: new Date(), stats: { verifiers: verifierDids.length, edges: edges.length, discovered: allDids.length } }).where((await import('drizzle-orm')).eq(crawlRuns.id, run.id))
}
```
`src/crawler/scheduler.ts`:
```ts
import cron from 'node-cron'
import { runCrawl } from './run'
const expr = process.env.VIDI_CRAWL_CRON ?? '0 3 * * *'
cron.schedule(expr, () => { runCrawl().catch((e) => console.error('crawl failed', e)) })
console.log(`vidi crawler scheduled: ${expr}`)
```
Install: `npm i node-cron && npm i -D @types/node-cron`.

- [ ] **Step 8: Run tests, verify pass** → `npm test tests/crawler` → PASS.

- [ ] **Step 9: Commit**

```bash
git add -A && git commit -m "feat(crawler): backwards follows signal, keyword seed, hydrate, run + scheduler"
```

---

## Phase 5 — Search

### Task 5.1: Search query builder

**Files:**
- Create: `src/lib/search/queryBuilder.ts`
- Test: `tests/lib/queryBuilder.test.ts`

**Interfaces:**
- Consumes: `db`, `accounts`, `accountVerifications`, `accountSignals`.
- Produces: `type SearchFilters = { text?: string; customDomainOnly?: boolean; verifiedByAnyOf?: string[]; followedByVerified?: boolean }`; `buildWhere(filters): SQL` (Drizzle condition builder) and `searchAccounts(filters, limit=50): Promise<AccountResult[]>`. `text` matches `handle ILIKE %text%` OR `description ILIKE %text%`. `verifiedByAnyOf` requires an `accountVerifications` row with `verifierDid` in the list. `followedByVerified` requires `accountSignals.followedByVerified = true`.

- [ ] **Step 1: Failing test — filter composition (unit, no DB)**

`tests/lib/queryBuilder.test.ts`:
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
})
```

- [ ] **Step 2: Run, verify fail** → FAIL.

- [ ] **Step 3: Implement query builder**

`src/lib/search/queryBuilder.ts`:
```ts
import { and, or, ilike, eq, inArray, exists, type SQL } from 'drizzle-orm'
import { db } from '../db/client'
import { accounts, accountVerifications, accountSignals } from '../db/schema'

export type SearchFilters = {
  text?: string
  customDomainOnly?: boolean
  verifiedByAnyOf?: string[]
  followedByVerified?: boolean
}

export function buildConditions(f: SearchFilters): SQL[] {
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
  return conds
}

export async function searchAccounts(f: SearchFilters, limit = 50) {
  const conds = buildConditions(f)
  const q = db.select().from(accounts)
  const rows = conds.length ? await q.where(and(...conds)).limit(limit) : await q.limit(limit)
  return rows
}
```

- [ ] **Step 4: Run, verify pass** → PASS.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(search): composable filter query builder over the index"
```

### Task 5.2: Search API route

**Files:**
- Create: `src/app/api/search/route.ts`
- Test: `tests/api/search.test.ts`

**Interfaces:**
- Consumes: `getActor`, `assertActiveMember`, `searchAccounts`.
- Produces: `POST /vidi/api/search {orgId, filters}` → `{ results }`. Requires an active member of `orgId`.

- [ ] **Step 1: Failing test — unauthenticated rejected**

`tests/api/search.test.ts`:
```ts
import { describe, it, expect, vi } from 'vitest'
vi.mock('../../src/lib/authz/session', () => ({ getActor: async () => null }))
import { POST } from '../../src/app/api/search/route'
describe('search route', () => {
  it('401 when not logged in', async () => {
    const req = new Request('http://x/vidi/api/search', { method: 'POST', body: JSON.stringify({ orgId: 1, filters: {} }) })
    expect((await POST(req as any)).status).toBe(401)
  })
})
```

- [ ] **Step 2: Run, verify fail** → FAIL.

- [ ] **Step 3: Implement**

`src/app/api/search/route.ts`:
```ts
import { NextRequest, NextResponse } from 'next/server'
import { getActor } from '../../lib/authz/session'
import { assertActiveMember, AuthzError } from '../../lib/authz/membership'
import { searchAccounts } from '../../lib/search/queryBuilder'
export async function POST(req: NextRequest) {
  const actor = await getActor()
  if (!actor) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })
  const { orgId, filters } = await req.json()
  try { await assertActiveMember(actor.did, orgId) }
  catch (e) { if (e instanceof AuthzError) return NextResponse.json({ error: e.message }, { status: 403 }); throw e }
  const results = await searchAccounts(filters ?? {})
  return NextResponse.json({ results })
}
```

- [ ] **Step 4: Run, verify pass** → PASS.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(search): authenticated search API"
```

---

## Phase 6 — Verify / revoke / backlog

### Task 6.1: Denylist + guardrails

**Files:**
- Create: `src/lib/denylist.ts`, `src/lib/verify/guardrails.ts`
- Test: `tests/lib/guardrails.test.ts`

**Interfaces:**
- Consumes: `accountVerifications`, `db`.
- Produces: `VERIFICATION_DENYLIST_DIDS: Set<string>` (from env `VIDI_DENYLIST_DIDS`); `alreadyVerified(orgDid, subjectDid): Promise<boolean>`; `type Guard = { ok: boolean; reason?: 'duplicate'|'denylist' }`; `checkGuards(orgDid, subjectDid): Promise<Guard>`.

- [ ] **Step 1: Failing test**

`tests/lib/guardrails.test.ts`:
```ts
import { describe, it, expect, vi } from 'vitest'
vi.mock('../../src/db/client', () => ({
  db: { select: () => ({ from: () => ({ where: async () => [] }) }) },
}))
import { checkGuards } from '../../src/lib/verify/guardrails'
describe('checkGuards', () => {
  it('blocks denylisted subjects', async () => {
    process.env.VIDI_DENYLIST_DIDS = 'did:plc:bad'
    const g = await checkGuards('did:plc:org', 'did:plc:bad')
    expect(g).toEqual({ ok: false, reason: 'denylist' })
  })
  it('allows a fresh, non-denylisted subject', async () => {
    process.env.VIDI_DENYLIST_DIDS = ''
    expect(await checkGuards('did:plc:org', 'did:plc:ok')).toEqual({ ok: true })
  })
})
```

- [ ] **Step 2: Run, verify fail** → FAIL.

- [ ] **Step 3: Implement**

`src/lib/denylist.ts`:
```ts
export function denylist(): Set<string> {
  return new Set((process.env.VIDI_DENYLIST_DIDS ?? '').split(',').map(s => s.trim()).filter(Boolean))
}
```
`src/lib/verify/guardrails.ts`:
```ts
import { and, eq } from 'drizzle-orm'
import { db } from '../db/client'
import { accountVerifications } from '../db/schema'
import { denylist } from '../denylist'

export type Guard = { ok: boolean; reason?: 'duplicate' | 'denylist' }

export async function alreadyVerified(orgDid: string, subjectDid: string): Promise<boolean> {
  const r = await db.select().from(accountVerifications)
    .where(and(eq(accountVerifications.verifierDid, orgDid), eq(accountVerifications.subjectDid, subjectDid)))
  return r.length > 0
}
export async function checkGuards(orgDid: string, subjectDid: string): Promise<Guard> {
  if (denylist().has(subjectDid)) return { ok: false, reason: 'denylist' }
  if (await alreadyVerified(orgDid, subjectDid)) return { ok: false, reason: 'duplicate' }
  return { ok: true }
}
```

- [ ] **Step 4: Run, verify pass** → PASS.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(verify): denylist + dedupe guardrails"
```

### Task 6.2: Verify service (write as org + audit)

**Files:**
- Create: `src/lib/verify/verifyService.ts`
- Test: `tests/lib/verifyService.test.ts`

**Interfaces:**
- Consumes: `getOrgAgent`, `checkGuards`, `accountVerifications`, `verificationActions`, `accounts` (for handle/displayName snapshot), `db`.
- Produces:
  - `verifyOne(params: { org: {id:number, did:string}, actorDid: string, subject: {did:string, handle:string, displayName?:string} }): Promise<{ outcome: 'verified'|'skipped-duplicate'|'skipped-denylist'|'error', recordUri?: string }>` — runs guards, `agent.com.atproto.repo.createRecord({repo: org.did, collection:'app.bsky.graph.verification', record:{subject, handle, displayName, createdAt}})`, writes `accountVerifications` + `verificationActions`.
  - `revokeOne(params: { org: {id:number, did:string}, actorDid: string, subjectDid: string }): Promise<{ outcome:'revoked'|'error' }>` — finds the org's `recordUri`, `deleteRecord`, deletes edge, audits.

- [ ] **Step 1: Failing test — dedupe short-circuits without a write**

`tests/lib/verifyService.test.ts`:
```ts
import { describe, it, expect, vi } from 'vitest'
const createRecord = vi.fn()
vi.mock('../../src/lib/atproto/orgAgent', () => ({ getOrgAgent: async () => ({ com: { atproto: { repo: { createRecord } } } }) }))
vi.mock('../../src/lib/verify/guardrails', () => ({ checkGuards: async () => ({ ok: false, reason: 'duplicate' }) }))
vi.mock('../../src/db/client', () => ({ db: { insert: () => ({ values: () => ({ onConflictDoUpdate: async () => {}, returning: async () => [{}] }) }) } }))
import { verifyOne } from '../../src/lib/verify/verifyService'
describe('verifyOne', () => {
  it('skips duplicates without writing a record', async () => {
    const res = await verifyOne({ org: { id: 1, did: 'did:plc:org' }, actorDid: 'did:plc:a', subject: { did: 'did:plc:s', handle: 's.bsky.social' } })
    expect(res.outcome).toBe('skipped-duplicate')
    expect(createRecord).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run, verify fail** → FAIL.

- [ ] **Step 3: Implement verify service**

`src/lib/verify/verifyService.ts`:
```ts
import { and, eq } from 'drizzle-orm'
import { db } from '../db/client'
import { accountVerifications, verificationActions } from '../db/schema'
import { getOrgAgent } from '../atproto/orgAgent'
import { checkGuards } from './guardrails'

type Org = { id: number; did: string }

async function audit(orgId: number, actorDid: string, action: 'verify'|'revoke', subjectDid: string, outcome: string, recordUri?: string) {
  await db.insert(verificationActions).values({ orgId, actorDid, action, subjectDid, outcome, recordUri })
}

export async function verifyOne(p: { org: Org; actorDid: string; subject: { did: string; handle: string; displayName?: string } }) {
  const guard = await checkGuards(p.org.did, p.subject.did)
  if (!guard.ok) {
    const outcome = guard.reason === 'denylist' ? 'skipped-denylist' as const : 'skipped-duplicate' as const
    await audit(p.org.id, p.actorDid, 'verify', p.subject.did, outcome)
    return { outcome }
  }
  try {
    const agent = await getOrgAgent(p.org.did)
    const createdAt = new Date().toISOString()
    const { data } = await agent.com.atproto.repo.createRecord({
      repo: p.org.did, collection: 'app.bsky.graph.verification',
      record: { subject: p.subject.did, handle: p.subject.handle, displayName: p.subject.displayName ?? '', createdAt },
    })
    await db.insert(accountVerifications)
      .values({ subjectDid: p.subject.did, verifierDid: p.org.did, recordUri: data.uri, createdAt: new Date(createdAt) })
      .onConflictDoUpdate({ target: [accountVerifications.subjectDid, accountVerifications.verifierDid], set: { recordUri: data.uri } })
    await audit(p.org.id, p.actorDid, 'verify', p.subject.did, 'verified', data.uri)
    return { outcome: 'verified' as const, recordUri: data.uri }
  } catch (e) {
    await audit(p.org.id, p.actorDid, 'verify', p.subject.did, 'error')
    return { outcome: 'error' as const }
  }
}

export async function revokeOne(p: { org: Org; actorDid: string; subjectDid: string }) {
  try {
    const rows = await db.select().from(accountVerifications)
      .where(and(eq(accountVerifications.verifierDid, p.org.did), eq(accountVerifications.subjectDid, p.subjectDid)))
    if (!rows[0]) return { outcome: 'error' as const }
    const uri = rows[0].recordUri
    const rkey = uri.split('/').pop()!
    const agent = await getOrgAgent(p.org.did)
    await agent.com.atproto.repo.deleteRecord({ repo: p.org.did, collection: 'app.bsky.graph.verification', rkey })
    await db.delete(accountVerifications).where(and(eq(accountVerifications.verifierDid, p.org.did), eq(accountVerifications.subjectDid, p.subjectDid)))
    await audit(p.org.id, p.actorDid, 'revoke', p.subjectDid, 'revoked', uri)
    return { outcome: 'revoked' as const }
  } catch {
    await audit(p.org.id, p.actorDid, 'revoke', p.subjectDid, 'error')
    return { outcome: 'error' as const }
  }
}
```

- [ ] **Step 4: Run, verify pass** → PASS.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(verify): verify/revoke as org with guardrails + audit log"
```

### Task 6.3: Verify / revoke / backlog API routes

**Files:**
- Create: `src/app/api/verify/route.ts`, `src/app/api/revoke/route.ts`, `src/app/api/backlog/route.ts`
- Test: `tests/api/verify.test.ts`

**Interfaces:**
- Consumes: `getActor`, `assertActiveMember`, `orgs` (resolve org DID from id), `verifyOne`, `revokeOne`, `backlogItems`.
- Produces:
  - `POST /vidi/api/verify {orgId, subjects:[{did,handle,displayName}]}` → `{ results:[{did,outcome}] }`; capped at `VIDI_BATCH_MAX` (default 50) per request.
  - `POST /vidi/api/revoke {orgId, subjectDid}` → `{ outcome }`.
  - `GET /vidi/api/backlog?orgId` → pending items; `POST /vidi/api/backlog {orgId, subjectDid, note}` (add/upsert pending); `PATCH /vidi/api/backlog {orgId, subjectDid, status}`.

- [ ] **Step 1: Failing test — batch cap enforced**

`tests/api/verify.test.ts`:
```ts
import { describe, it, expect, vi } from 'vitest'
vi.mock('../../src/lib/authz/session', () => ({ getActor: async () => ({ did: 'did:plc:a' }) }))
vi.mock('../../src/lib/authz/membership', () => ({ assertActiveMember: async () => {}, AuthzError: class extends Error { status = 403 } }))
vi.mock('../../src/db/client', () => ({ db: { select: () => ({ from: () => ({ where: async () => [{ id: 1, did: 'did:plc:org' }] }) }) } }))
vi.mock('../../src/lib/verify/verifyService', () => ({ verifyOne: async ({ subject }: any) => ({ did: subject.did, outcome: 'verified' }) }))
import { POST } from '../../src/app/api/verify/route'
describe('verify route batch cap', () => {
  it('rejects oversized batches', async () => {
    process.env.VIDI_BATCH_MAX = '2'
    const subjects = Array.from({ length: 3 }, (_, i) => ({ did: `did:plc:${i}`, handle: `h${i}` }))
    const req = new Request('http://x/vidi/api/verify', { method: 'POST', body: JSON.stringify({ orgId: 1, subjects }) })
    expect((await POST(req as any)).status).toBe(400)
  })
})
```

- [ ] **Step 2: Run, verify fail** → FAIL.

- [ ] **Step 3: Implement routes**

`src/app/api/verify/route.ts`:
```ts
import { NextRequest, NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { db } from '../../db/client'
import { orgs } from '../../db/schema'
import { getActor } from '../../lib/authz/session'
import { assertActiveMember, AuthzError } from '../../lib/authz/membership'
import { verifyOne } from '../../lib/verify/verifyService'

export async function POST(req: NextRequest) {
  const actor = await getActor(); if (!actor) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })
  const { orgId, subjects } = await req.json()
  const cap = Number(process.env.VIDI_BATCH_MAX ?? 50)
  if (!Array.isArray(subjects) || subjects.length === 0) return NextResponse.json({ error: 'no_subjects' }, { status: 400 })
  if (subjects.length > cap) return NextResponse.json({ error: 'batch_too_large', cap }, { status: 400 })
  try { await assertActiveMember(actor.did, orgId) }
  catch (e) { if (e instanceof AuthzError) return NextResponse.json({ error: e.message }, { status: 403 }); throw e }
  const [org] = await db.select().from(orgs).where(eq(orgs.id, orgId))
  if (!org) return NextResponse.json({ error: 'org_not_found' }, { status: 404 })
  const results = []
  for (const s of subjects) {
    const r = await verifyOne({ org: { id: org.id, did: org.did }, actorDid: actor.did, subject: s })
    results.push({ did: s.did, ...r })
  }
  return NextResponse.json({ results })
}
```
`src/app/api/revoke/route.ts`:
```ts
import { NextRequest, NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { db } from '../../db/client'
import { orgs } from '../../db/schema'
import { getActor } from '../../lib/authz/session'
import { assertActiveMember, AuthzError } from '../../lib/authz/membership'
import { revokeOne } from '../../lib/verify/verifyService'
export async function POST(req: NextRequest) {
  const actor = await getActor(); if (!actor) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })
  const { orgId, subjectDid } = await req.json()
  try { await assertActiveMember(actor.did, orgId) }
  catch (e) { if (e instanceof AuthzError) return NextResponse.json({ error: e.message }, { status: 403 }); throw e }
  const [org] = await db.select().from(orgs).where(eq(orgs.id, orgId))
  if (!org) return NextResponse.json({ error: 'org_not_found' }, { status: 404 })
  return NextResponse.json(await revokeOne({ org: { id: org.id, did: org.did }, actorDid: actor.did, subjectDid }))
}
```
`src/app/api/backlog/route.ts`:
```ts
import { NextRequest, NextResponse } from 'next/server'
import { and, eq } from 'drizzle-orm'
import { db } from '../../db/client'
import { backlogItems } from '../../db/schema'
import { getActor } from '../../lib/authz/session'
import { assertActiveMember, AuthzError } from '../../lib/authz/membership'

async function guardMember(actorDid: string, orgId: number) {
  await assertActiveMember(actorDid, orgId)
}
export async function GET(req: NextRequest) {
  const actor = await getActor(); if (!actor) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })
  const orgId = Number(req.nextUrl.searchParams.get('orgId'))
  try { await guardMember(actor.did, orgId) } catch (e) { if (e instanceof AuthzError) return NextResponse.json({ error: e.message }, { status: 403 }); throw e }
  const rows = await db.select().from(backlogItems).where(and(eq(backlogItems.orgId, orgId), eq(backlogItems.status, 'pending')))
  return NextResponse.json({ items: rows })
}
export async function POST(req: NextRequest) {
  const actor = await getActor(); if (!actor) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })
  const { orgId, subjectDid, note } = await req.json()
  try { await guardMember(actor.did, orgId) } catch (e) { if (e instanceof AuthzError) return NextResponse.json({ error: e.message }, { status: 403 }); throw e }
  await db.insert(backlogItems).values({ orgId, subjectDid, note, addedByDid: actor.did, status: 'pending' })
    .onConflictDoUpdate({ target: [backlogItems.orgId, backlogItems.subjectDid], set: { status: 'pending', note } })
  return NextResponse.json({ ok: true })
}
export async function PATCH(req: NextRequest) {
  const actor = await getActor(); if (!actor) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })
  const { orgId, subjectDid, status } = await req.json()
  try { await guardMember(actor.did, orgId) } catch (e) { if (e instanceof AuthzError) return NextResponse.json({ error: e.message }, { status: 403 }); throw e }
  await db.update(backlogItems).set({ status })
    .where(and(eq(backlogItems.orgId, orgId), eq(backlogItems.subjectDid, subjectDid)))
  return NextResponse.json({ ok: true })
}
```

- [ ] **Step 4: Run, verify pass** → PASS.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(api): verify (batch-capped), revoke, and shared backlog routes"
```

---

## Phase 7 — UI

### Task 7.1: Login + org context shell

**Files:**
- Create: `src/app/page.tsx` (login), `src/app/(app)/layout.tsx` (nav + org selector), `src/lib/hooks/useOrg.ts`
- Test: `tests/ui/login.test.tsx` (render smoke via `@testing-library/react`)

**Interfaces:**
- Consumes: `/vidi/api/auth/login`, `/vidi/api/members`.
- Produces: a login form posting a handle → redirect to returned `url`; an app shell with nav links to Search / Backlog / Members and the current org.

- [ ] **Step 1: Install testing libs**

```bash
npm i -D @testing-library/react @testing-library/jest-dom jsdom
```
Update `vitest.config.ts` to add a jsdom project for `tests/ui/**`.

- [ ] **Step 2: Failing render test**

`tests/ui/login.test.tsx`:
```tsx
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import LoginPage from '../../src/app/page'
describe('LoginPage', () => {
  it('renders a handle input', () => {
    render(<LoginPage />)
    expect(screen.getByPlaceholderText(/handle/i)).toBeTruthy()
  })
})
```

- [ ] **Step 3: Run, verify fail** → FAIL.

- [ ] **Step 4: Implement login page + shell**

`src/app/page.tsx`:
```tsx
'use client'
import { useState } from 'react'
export default function LoginPage() {
  const [handle, setHandle] = useState('')
  async function login() {
    const res = await fetch('/vidi/api/auth/login', { method: 'POST', body: JSON.stringify({ handle }) })
    const { url } = await res.json(); window.location.href = url
  }
  return (
    <main style={{ maxWidth: 420, margin: '4rem auto', fontFamily: 'system-ui' }}>
      <h1>Vidi</h1>
      <p>Sign in with your atproto handle to verify accounts.</p>
      <input placeholder="you.handle" value={handle} onChange={(e) => setHandle(e.target.value)} />
      <button onClick={login}>Sign in</button>
    </main>
  )
}
```
`src/app/(app)/layout.tsx`:
```tsx
import Link from 'next/link'
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontFamily: 'system-ui' }}>
      <nav style={{ display: 'flex', gap: 16, padding: 12, borderBottom: '1px solid #ddd' }}>
        <strong>Vidi</strong>
        <Link href="/vidi/search">Search</Link>
        <Link href="/vidi/backlog">Backlog</Link>
        <Link href="/vidi/members">Members</Link>
      </nav>
      <main style={{ padding: 16 }}>{children}</main>
    </div>
  )
}
```
`src/lib/hooks/useOrg.ts`:
```ts
'use client'
import { useEffect, useState } from 'react'
// v1: single-org context resolved from /vidi/api/members bootstrap; stored in state.
export function useOrg() {
  const [orgId, setOrgId] = useState<number | null>(null)
  useEffect(() => {
    fetch('/vidi/api/org/context').then(r => r.json()).then(d => setOrgId(d.orgId ?? null)).catch(() => {})
  }, [])
  return { orgId, setOrgId }
}
```
Add supporting route `src/app/api/org/context/route.ts`:
```ts
import { NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { db } from '../../db/client'
import { members } from '../../db/schema'
import { getActor } from '../../lib/authz/session'
export async function GET() {
  const actor = await getActor(); if (!actor) return NextResponse.json({ orgId: null }, { status: 401 })
  const rows = await db.select().from(members).where(eq(members.memberDid, actor.did))
  const active = rows.find(r => r.status === 'active')
  return NextResponse.json({ orgId: active?.orgId ?? null, role: active?.role ?? null })
}
```

- [ ] **Step 5: Run, verify pass** → PASS.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat(ui): login + app shell + org context"
```

### Task 7.2: Search + results + verify/backlog actions

**Files:**
- Create: `src/app/(app)/search/page.tsx`, `src/components/AccountCard.tsx`, `src/components/SearchForm.tsx`
- Test: `tests/ui/searchForm.test.tsx`

**Interfaces:**
- Consumes: `/vidi/api/search`, `/vidi/api/verify`, `/vidi/api/backlog`, `useOrg`.
- Produces: a filter form (text, custom-domain toggle, TV multi-select, followed-by-verified toggle), results list with multi-select, and "Verify selected" / "Add to backlog" buttons showing per-item outcomes.

- [ ] **Step 1: Failing test — form exposes all four filters**

`tests/ui/searchForm.test.tsx`:
```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { SearchForm } from '../../src/components/SearchForm'
describe('SearchForm', () => {
  it('renders all four filter controls', () => {
    render(<SearchForm trustedVerifiers={[{ did: 'did:plc:tv', handle: 'france-atmosphe.re' }]} onSearch={vi.fn()} />)
    expect(screen.getByLabelText(/text in bio or handle/i)).toBeTruthy()
    expect(screen.getByLabelText(/handle is a domain/i)).toBeTruthy()
    expect(screen.getByLabelText(/followed by a verified account/i)).toBeTruthy()
    expect(screen.getByText(/france-atmosphe\.re/)).toBeTruthy()
  })
})
```

- [ ] **Step 2: Run, verify fail** → FAIL.

- [ ] **Step 3: Implement SearchForm, AccountCard, search page**

`src/components/SearchForm.tsx`:
```tsx
'use client'
import { useState } from 'react'
type TV = { did: string; handle: string }
export function SearchForm({ trustedVerifiers, onSearch }: { trustedVerifiers: TV[]; onSearch: (f: any) => void }) {
  const [text, setText] = useState('')
  const [customDomainOnly, setCustom] = useState(false)
  const [followedByVerified, setFollowed] = useState(false)
  const [verifiedByAnyOf, setTVs] = useState<string[]>([])
  return (
    <form onSubmit={(e) => { e.preventDefault(); onSearch({ text, customDomainOnly, followedByVerified, verifiedByAnyOf }) }}>
      <label>Text in bio or handle
        <input value={text} onChange={(e) => setText(e.target.value)} /></label>
      <label><input type="checkbox" checked={customDomainOnly} onChange={(e) => setCustom(e.target.checked)} /> Handle is a domain</label>
      <label><input type="checkbox" checked={followedByVerified} onChange={(e) => setFollowed(e.target.checked)} /> Followed by a verified account</label>
      <fieldset><legend>Verified by</legend>
        {trustedVerifiers.map((tv) => (
          <label key={tv.did}><input type="checkbox" onChange={(e) =>
            setTVs((prev) => e.target.checked ? [...prev, tv.did] : prev.filter((d) => d !== tv.did))} /> {tv.handle}</label>
        ))}
      </fieldset>
      <button type="submit">Search</button>
    </form>
  )
}
```
`src/components/AccountCard.tsx`:
```tsx
'use client'
export function AccountCard({ acc, selected, onToggle }: { acc: any; selected: boolean; onToggle: () => void }) {
  return (
    <div style={{ border: '1px solid #ddd', padding: 8, borderRadius: 8 }}>
      <label><input type="checkbox" checked={selected} onChange={onToggle} /> <strong>{acc.displayName || acc.handle}</strong></label>
      <div>@{acc.handle} {acc.isCustomDomain ? '🌐' : ''}</div>
      <p>{acc.description}</p>
    </div>
  )
}
```
`src/app/(app)/search/page.tsx`:
```tsx
'use client'
import { useEffect, useState } from 'react'
import { SearchForm } from '../../../components/SearchForm'
import { AccountCard } from '../../../components/AccountCard'
import { useOrg } from '../../../lib/hooks/useOrg'
export default function SearchPage() {
  const { orgId } = useOrg()
  const [tvs, setTvs] = useState<any[]>([])
  const [results, setResults] = useState<any[]>([])
  const [sel, setSel] = useState<Set<string>>(new Set())
  useEffect(() => { fetch('/vidi/api/trusted-verifiers').then(r => r.json()).then(d => setTvs(d.verifiers ?? [])) }, [])
  async function search(filters: any) {
    const r = await fetch('/vidi/api/search', { method: 'POST', body: JSON.stringify({ orgId, filters }) })
    setResults((await r.json()).results ?? []); setSel(new Set())
  }
  async function verify() {
    const subjects = results.filter(a => sel.has(a.did)).map(a => ({ did: a.did, handle: a.handle, displayName: a.displayName }))
    const r = await fetch('/vidi/api/verify', { method: 'POST', body: JSON.stringify({ orgId, subjects }) })
    alert(JSON.stringify((await r.json()).results))
  }
  async function backlog() {
    for (const a of results.filter(x => sel.has(x.did)))
      await fetch('/vidi/api/backlog', { method: 'POST', body: JSON.stringify({ orgId, subjectDid: a.did }) })
    alert('Added to backlog')
  }
  return (
    <div>
      <SearchForm trustedVerifiers={tvs} onSearch={search} />
      <div style={{ display: 'flex', gap: 8, margin: '12px 0' }}>
        <button onClick={verify} disabled={!sel.size}>Verify selected</button>
        <button onClick={backlog} disabled={!sel.size}>Add to backlog</button>
      </div>
      <div style={{ display: 'grid', gap: 8 }}>
        {results.map((a) => (
          <AccountCard key={a.did} acc={a} selected={sel.has(a.did)}
            onToggle={() => setSel((p) => { const n = new Set(p); n.has(a.did) ? n.delete(a.did) : n.add(a.did); return n })} />
        ))}
      </div>
    </div>
  )
}
```
Add `src/app/api/trusted-verifiers/route.ts`:
```ts
import { NextResponse } from 'next/server'
import { db } from '../../db/client'
import { trustedVerifiers } from '../../db/schema'
export async function GET() {
  const verifiers = await db.select().from(trustedVerifiers)
  return NextResponse.json({ verifiers })
}
```

- [ ] **Step 4: Run, verify pass** → PASS.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(ui): search form, results, verify/backlog actions"
```

### Task 7.3: Backlog + Members pages

**Files:**
- Create: `src/app/(app)/backlog/page.tsx`, `src/app/(app)/members/page.tsx`
- Test: `tests/ui/members.test.tsx`

**Interfaces:**
- Consumes: `/vidi/api/backlog`, `/vidi/api/verify`, `/vidi/api/members`, `/vidi/api/org/context` (for role).
- Produces: backlog list with "Verify" / "Skip" per item; members list with invite form (owner only) + revoke button (owner only).

- [ ] **Step 1: Failing test — invite form hidden for helper**

`tests/ui/members.test.tsx`:
```tsx
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MembersView } from '../../src/app/(app)/members/page'
describe('MembersView', () => {
  it('hides invite form for helpers', () => {
    render(<MembersView role="helper" members={[]} orgId={1} />)
    expect(screen.queryByText(/invite helper/i)).toBeNull()
  })
  it('shows invite form for owners', () => {
    render(<MembersView role="owner" members={[]} orgId={1} />)
    expect(screen.getByText(/invite helper/i)).toBeTruthy()
  })
})
```

- [ ] **Step 2: Run, verify fail** → FAIL.

- [ ] **Step 3: Implement pages (export testable `MembersView`)**

`src/app/(app)/members/page.tsx`:
```tsx
'use client'
import { useEffect, useState } from 'react'
import { useOrg } from '../../../lib/hooks/useOrg'

export function MembersView({ role, members, orgId }: { role: string; members: any[]; orgId: number }) {
  const [handle, setHandle] = useState(''); const [did, setDid] = useState('')
  async function invite() {
    await fetch('/vidi/api/members', { method: 'POST', body: JSON.stringify({ orgId, handle, did }) })
    location.reload()
  }
  async function revoke(memberDid: string) {
    await fetch('/vidi/api/members', { method: 'DELETE', body: JSON.stringify({ orgId, memberDid }) })
    location.reload()
  }
  return (
    <div>
      <h2>Members</h2>
      <ul>{members.map((m) => (
        <li key={m.memberDid}>{m.handle} ({m.role})
          {role === 'owner' && m.role !== 'owner' && <button onClick={() => revoke(m.memberDid)}>Revoke</button>}
        </li>
      ))}</ul>
      {role === 'owner' && (
        <div>
          <h3>Invite helper</h3>
          <input placeholder="handle" value={handle} onChange={(e) => setHandle(e.target.value)} />
          <input placeholder="did:plc:…" value={did} onChange={(e) => setDid(e.target.value)} />
          <button onClick={invite}>Invite</button>
        </div>
      )}
    </div>
  )
}
export default function MembersPage() {
  const { orgId } = useOrg()
  const [role, setRole] = useState('helper'); const [members, setMembers] = useState<any[]>([])
  useEffect(() => {
    fetch('/vidi/api/org/context').then(r => r.json()).then(d => setRole(d.role ?? 'helper'))
    if (orgId) fetch(`/vidi/api/members?orgId=${orgId}`).then(r => r.json()).then(d => setMembers(d.members ?? []))
  }, [orgId])
  return orgId ? <MembersView role={role} members={members} orgId={orgId} /> : <p>Loading…</p>
}
```
`src/app/(app)/backlog/page.tsx`:
```tsx
'use client'
import { useEffect, useState } from 'react'
import { useOrg } from '../../../lib/hooks/useOrg'
export default function BacklogPage() {
  const { orgId } = useOrg()
  const [items, setItems] = useState<any[]>([])
  useEffect(() => { if (orgId) fetch(`/vidi/api/backlog?orgId=${orgId}`).then(r => r.json()).then(d => setItems(d.items ?? [])) }, [orgId])
  async function act(subjectDid: string, status: string) {
    await fetch('/vidi/api/backlog', { method: 'PATCH', body: JSON.stringify({ orgId, subjectDid, status }) })
    setItems((p) => p.filter((i) => i.subjectDid !== subjectDid))
  }
  return (
    <div>
      <h2>To Be Verified</h2>
      <ul>{items.map((i) => (
        <li key={i.subjectDid}>{i.subjectDid}
          <button onClick={() => act(i.subjectDid, 'verified')}>Mark verified</button>
          <button onClick={() => act(i.subjectDid, 'skipped')}>Skip</button>
        </li>
      ))}</ul>
    </div>
  )
}
```

- [ ] **Step 4: Run, verify pass** → PASS.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(ui): backlog and members pages with role-gated controls"
```

---

## Phase 8 — Seed scripts & release

### Task 8.1: Seed script (allowlist + crawl seeds) + first-run docs

**Files:**
- Create: `scripts/seed.ts`, update `README.md`
- Test: `tests/scripts/seed.test.ts`

**Interfaces:**
- Consumes: `addToAllowlist`, `crawlSeeds`.
- Produces: `seed()` — reads `VIDI_SEED_ALLOWLIST` (comma DIDs) + `VIDI_SEED_KEYWORDS` (comma) env and upserts them; safe to re-run.

- [ ] **Step 1: Failing test — parses env into rows**

`tests/scripts/seed.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { parseSeeds } from '../../scripts/seed'
describe('parseSeeds', () => {
  it('splits and trims env lists', () => {
    expect(parseSeeds('a, b ,c')).toEqual(['a', 'b', 'c'])
    expect(parseSeeds('')).toEqual([])
  })
})
```

- [ ] **Step 2: Run, verify fail** → FAIL.

- [ ] **Step 3: Implement seed script**

`scripts/seed.ts`:
```ts
import { db } from '../src/db/client'
import { crawlSeeds } from '../src/db/schema'
import { addToAllowlist } from '../src/lib/allowlist'

export function parseSeeds(s: string): string[] {
  return s.split(',').map((x) => x.trim()).filter(Boolean)
}
export async function seed() {
  for (const did of parseSeeds(process.env.VIDI_SEED_ALLOWLIST ?? '')) await addToAllowlist(did, '', 'seed')
  for (const kw of parseSeeds(process.env.VIDI_SEED_KEYWORDS ?? ''))
    await db.insert(crawlSeeds).values({ keyword: kw, enabled: true }).onConflictDoNothing()
}
if (require.main === module) seed().then(() => process.exit(0))
```

- [ ] **Step 4: README first-run section**

Add to `README.md`: env setup, `docker compose run --rm app node dist/db/migrate.js`, `... node dist/scripts/seed.js`, then owner logs in as the org account at `/vidi` and POSTs `/vidi/api/org/onboard`.

- [ ] **Step 5: Run, verify pass** → PASS.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat(seed): allowlist + crawl-keyword seeding script and first-run docs"
```

### Task 8.2: Full-stack integration smoke (docker compose)

**Files:**
- Create: `tests/integration/smoke.md` (manual checklist) — automated e2e deferred (YAGNI for v1).

- [ ] **Step 1: Manual smoke checklist**

Document steps: build images, `docker compose up`, run migrate + seed, hit `/vidi/api/health`, log in as org, onboard, run `docker compose run --rm worker node dist/crawler/run.js` (add a `run.js` CLI entry), verify a test account, confirm the `app.bsky.graph.verification` record exists via `com.atproto.repo.listRecords`, revoke it, confirm deletion, check `verification_actions` rows.

- [ ] **Step 2: Add crawler CLI entry**

`src/crawler/run.ts` already exports `runCrawl`; add at bottom:
```ts
if (require.main === module) runCrawl().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
```

- [ ] **Step 3: Commit**

```bash
git add -A && git commit -m "chore: integration smoke checklist + crawler CLI entry"
```

---

## Self-Review

**Spec coverage:**
- §2 verify/revoke via `app.bsky.graph.verification` → Tasks 6.2, 6.3. ✅
- §3 actor-vs-writer → Tasks 2.2–2.4 (actor cookie), 3.2 (org writer), audit in 6.2. ✅
- §4 deployment (Compose, Caddy, subpath, CI) → Tasks 0.2, 0.3; basePath 0.1. ✅
- §5 OAuth + roles + allowlist → Tasks 2.3, 2.4, 3.1–3.4. ✅
- §6 data model → Task 1.1 (all tables). ✅
- §7 four search filters → Tasks 4.1 (custom domain), 5.1 (all four), 7.2 (UI). ✅
- §8 crawler (TV resolve, verifications, backwards follows, keyword seed, hydrate) → Tasks 4.2–4.4. ✅
- §9 verify/revoke flows incl. guardrails + batch cap → Tasks 6.1–6.3. ✅
- §10 error handling: batch per-item outcomes (6.2/6.3), token-expiry surfaced via `getOrgAgent` failure → `error` outcome (6.2); **UI re-auth banner is minimal in v1** (owner sees `error` outcomes) — acceptable for v1, noted as future polish. ✅
- §11 security (encryption, DPoP via client, allowlist gate, attribution) → Tasks 2.1–2.3, 3.1, 6.2. ✅
- §12 testing → every task is TDD. ✅
- §13 YAGNI (no categories, no native app, batch cap) → respected. ✅

**Placeholder scan:** No TBD/TODO in requirements; every code step has real code. The only deferred item is automated e2e (explicitly YAGNI, replaced by a manual checklist in 8.2).

**Type consistency:** `verifyOne`/`revokeOne` signatures in Task 6.2 match their callers in 6.3; `SearchFilters` in 5.1 matches the UI payload in 7.2; `getOrgAgent(orgDid)` used consistently (2.2 → 3.2 → 6.2); `assertActiveMember`/`assertOwner`/`AuthzError` consistent across 3.3, 3.4, 5.2, 6.3. `accountVerifications` unique target `(subjectDid, verifierDid)` used consistently in crawler (4.3) and verify service (6.2).

**One gap fixed inline:** the search UI needs the TV list and org context, so Tasks 7.1/7.2 add `/vidi/api/org/context` and `/vidi/api/trusted-verifiers` routes (small, member-gated where needed).
