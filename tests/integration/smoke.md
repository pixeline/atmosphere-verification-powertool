# Integration Smoke Checklist

This is a **manual end-to-end checklist** for validating the full Vidi stack in a local Docker Compose environment. It covers build, deployment, migrations, authentication, crawling, search, verification lifecycle, and permission boundaries.

**Note:** Automated e2e testing is deferred (YAGNI for v1). This checklist exercises critical paths: Docker Compose deployment, OAuth + onboarding, crawler CLI, live SQL + pg_trgm search, ATProto record verification, and role-based access.

---

## Prerequisites

- Docker and Docker Compose installed
- Node.js 18+ and npm installed
- Access to a Bluesky test server (or `mu.social`) with test accounts
- A `.env.local` file configured with:
  - `DATABASE_URL` (local Postgres)
  - `MU_APPVIEW_URL` (test Bluesky service URL)
  - `OAUTH_ISSUER` (test OAuth provider)
  - `OAUTH_CLIENT_ID` and `OAUTH_CLIENT_SECRET` (test OAuth app credentials)

---

## Phase 1: Build & Docker Compose Startup

### 1.1: Build Docker Images

```bash
docker compose build
```

**Expected:** All services build without error.
- `app`: Next.js frontend + API routes
- `worker`: Node crawler service
- `db`: PostgreSQL with Drizzle ORM

### 1.2: Start Docker Compose Stack

```bash
docker compose up -d
```

**Expected:**
- All services start successfully
- `docker compose ps` shows:
  - `app` running on port 3000
  - `worker` running (health checks passing)
  - `db` running on port 5432

### 1.3: Check Service Logs

```bash
docker compose logs -f
```

**Expected:** No fatal errors; services initialize and await requests.

---

## Phase 2: Database Setup & Health Check

### 2.1: Run Database Migrations

```bash
docker compose run --rm app npm run db:migrate
```

**Expected:**
- All migrations run successfully
- `schema_migrations` table populated
- Core tables present: `orgs`, `org_members`, `account_verifications`, `crawl_runs`, etc.

### 2.2: Seed Test Data (if applicable)

```bash
docker compose run --rm app npm run db:seed
```

**Expected:** Test fixtures inserted (if a seed script exists); no duplicate key errors.

### 2.3: Hit Health Endpoint

```bash
curl http://localhost:3000/vidi/api/health
```

**Expected Response:**
```json
{ "status": "ok" }
```

**What it validates:** App service is running and DB connection is live.

---

## Phase 3: Authentication & Org Onboarding

### 3.1: Owner Login (OAuth Flow)

1. Open http://localhost:3000/vidi in a browser
2. Click "Sign In"
3. Redirect to OAuth provider
4. Log in with an owner test account (e.g., `owner.test.bsky@appview`)
5. Authorize scopes
6. Redirect back to http://localhost:3000/vidi/dashboard

**Expected:** User is authenticated; session cookie set; can see dashboard.

### 3.2: Org Onboarding

1. On dashboard, click "Create Organization" or navigate to `/vidi/onboard`
2. Fill in org details:
   - Organization name (e.g., "Test Org")
   - Bluesky DID (retrieve from profile; e.g., `did:plc:abc123...`)
3. Submit onboarding form → POST `/vidi/api/org/onboard`

**Expected Response:**
```json
{
  "orgId": "...",
  "did": "did:plc:...",
  "createdAt": "2026-07-06T...",
  "displayName": "Test Org"
}
```

**Validate:**
- Org row inserted in `orgs` table
- Owner row inserted in `org_members` table with role `owner`
- Session context now includes `orgId`

---

## Phase 4: Crawler Execution

### 4.1: Run Crawler Once

```bash
docker compose run --rm worker npx tsx src/crawler/run.ts
```

**Expected:**
- No errors on stdout/stderr
- Process exits with code 0
- New row inserted in `crawl_runs` table with `finishedAt` timestamp
- Stats populated: `{ verifiers: N, edges: M, discovered: K }`

**What it validates:**
- ESM CLI entry (`import.meta.url` guard) executes correctly
- All crawler phases run (trusted verifiers sync, verifications crawl, follows collection, keyword seed, hydrate)
- Database writes succeed under concurrency

### 4.2: Verify Crawler Output in DB

```bash
docker compose exec db psql $DATABASE_URL -c "SELECT * FROM crawl_runs ORDER BY created_at DESC LIMIT 1;"
```

**Expected:** Latest run has `finishedAt` not null and stats populated.

---

## Phase 5: Live Search with All 4 Filters

### 5.1: Text Search Filter (including emoji & TLD substring)

**Test Case:** Search for a known verified account or keyword containing emoji/TLD.

```bash
curl -X POST http://localhost:3000/vidi/api/search \
  -H "Content-Type: application/json" \
  -d '{
    "textQuery": "test🎉 .app",
    "customDomainOnly": false
  }'
```

**Expected:**
- HTTP 200
- Results include accounts matching the text query (pg_trgm trigram search)
- Emoji and TLD substring match correctly (SQL `LIKE` or trigram index)

### 5.2: Custom Domain Only Filter

```bash
curl -X POST http://localhost:3000/vidi/api/search \
  -H "Content-Type: application/json" \
  -d '{
    "textQuery": "",
    "customDomainOnly": true
  }'
```

**Expected:**
- HTTP 200
- Results include only accounts with `customDomainVerified = true` in `accounts` table

### 5.3: Verified By Any Of Filter

First, retrieve trusted verifier DIDs from the crawler output:

```bash
curl http://localhost:3000/vidi/api/trusted-verifiers \
  -H "Authorization: Bearer <org-session-token>"
```

Then search:

```bash
curl -X POST http://localhost:3000/vidi/api/search \
  -H "Content-Type: application/json" \
  -d '{
    "textQuery": "",
    "customDomainOnly": false
  }'
```

**Expected:**
- HTTP 200
- Results include only accounts verified by (at least) one of the specified verifiers
- SQL `EXISTS (SELECT 1 FROM account_verifications WHERE ... verifierDid IN (...))` executes against live DB

---

## Phase 6: Verification Lifecycle (Create, Inspect, Revoke)

### 6.1: Create a Test Verification

1. Pick a test account DID (e.g., `did:plc:subject123`)
2. As org owner, POST `/vidi/api/org/verify`:

```bash
curl -X POST http://localhost:3000/vidi/api/org/verify \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <org-session-token>" \
  -d '{
    "subjectDid": "did:plc:subject123"
  }'
```

**Expected Response:**
```json
{
  "subjectDid": "did:plc:subject123",
  "verifierDid": "did:plc:org123",
  "createdAt": "2026-07-06T...",
  "status": "pending"
}
```

**Validate in DB:**
```bash
docker compose exec db psql $DATABASE_URL -c \
  "SELECT * FROM account_verifications WHERE subject_did = 'did:plc:subject123';"
```

### 6.2: Inspect ATProto Verification Record

Using the `com.atproto.repo.listRecords` API (via Bluesky SDK or curl):

```bash
# Assuming a test client library or direct HTTP call:
curl -X GET "https://mu.social/xrpc/com.atproto.repo.listRecords?repo=did:plc:org123&collection=app.bsky.graph.verification&rLimit=100" \
  -H "Authorization: Bearer <admin-token>"
```

**Expected:** One or more `app.bsky.graph.verification` records with:
- `subjectDid: "did:plc:subject123"`
- `verifierDid: "did:plc:org123"`
- `createdAt` timestamp

**What it validates:** Verification record was written to ATProto and is queryable via XRPC.

### 6.3: Check Verification Audit Trail

```bash
docker compose exec db psql $DATABASE_URL -c \
  "SELECT * FROM verification_actions WHERE subject_did = 'did:plc:subject123' ORDER BY created_at;"
```

**Expected:** Rows showing:
- `action: "create"` with timestamp
- `actor_did: "did:plc:org123"` (the org owner)
- Metadata/reason if applicable

### 6.4: Revoke the Verification

```bash
curl -X POST http://localhost:3000/vidi/api/org/revoke \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <org-session-token>" \
  -d '{
    "subjectDid": "did:plc:subject123"
  }'
```

**Expected Response:** HTTP 200 with success message (or empty body).

**Validate in DB:**
- `account_verifications` row marked as `deleted_at` (soft delete) or removed
- New `verification_actions` row with `action: "revoke"`

### 6.5: Confirm ATProto Record Deletion

```bash
curl -X GET "https://mu.social/xrpc/com.atproto.repo.listRecords?repo=did:plc:org123&collection=app.bsky.graph.verification&rLimit=100" \
  -H "Authorization: Bearer <admin-token>"
```

**Expected:** The record for `did:plc:subject123` is no longer present (or marked deleted).

---

## Phase 7: Role-Based Access Control

### 7.1: Invite a Helper Member

As org owner, POST `/vidi/api/org/members/invite`:

```bash
curl -X POST http://localhost:3000/vidi/api/org/members/invite \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <owner-token>" \
  -d '{
    "inviteeDid": "did:plc:helper123",
    "role": "verifier"
  }'
```

**Expected Response:**
```json
{
  "orgId": "...",
  "memberDid": "did:plc:helper123",
  "role": "verifier",
  "invitedAt": "2026-07-06T...",
  "acceptedAt": null
}
```

### 7.2: Helper Can Verify

Log in as helper account. POST `/vidi/api/org/verify` with a new subject:

```bash
curl -X POST http://localhost:3000/vidi/api/org/verify \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <helper-token>" \
  -d '{
    "subjectDid": "did:plc:subject456"
  }'
```

**Expected:** HTTP 200; verification created. Helper role permits verification.

### 7.3: Helper Cannot Invite

Try to invite another member as helper:

```bash
curl -X POST http://localhost:3000/vidi/api/org/members/invite \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <helper-token>" \
  -d '{
    "inviteeDid": "did:plc:another123",
    "role": "verifier"
  }'
```

**Expected:** HTTP 403 or `AuthzError`; only owner can invite.

### 7.4: Helper Cannot Revoke (unless policy allows)

Try to revoke a verification (created by owner) as helper:

```bash
curl -X POST http://localhost:3000/vidi/api/org/revoke \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <helper-token>" \
  -d '{
    "subjectDid": "did:plc:subject123"
  }'
```

**Expected:** Either:
- HTTP 403 if verifier role cannot revoke, or
- HTTP 200 if revoking one's own verifications is allowed (depends on spec)

**Validate in `verification_actions` table:** Action is attributable to correct actor.

---

## Phase 8: Cleanup & Teardown

### 8.1: Tear Down Stack

```bash
docker compose down -v
```

**Expected:** All containers stopped and volumes removed.

### 8.2: Verify No Dangling Processes

```bash
docker compose ps
```

**Expected:** No containers listed.

---

## Checklist Summary

- [ ] Phase 1: Docker images build and services start
- [ ] Phase 2: Migrations run; health endpoint responds
- [ ] Phase 3: OAuth login; org onboarding completes
- [ ] Phase 4: Crawler CLI runs successfully; stats recorded
- [ ] Phase 5.1: Text search (emoji/TLD) returns results
- [ ] Phase 5.2: Custom domain filter works
- [ ] Phase 5.3: Verified by filter works with `EXISTS()` query
- [ ] Phase 6.1–6.3: Verification created and ATProto record visible
- [ ] Phase 6.4–6.5: Verification revoked and ATProto record deleted
- [ ] Phase 6.3: Verification audit trail logged correctly
- [ ] Phase 7.1–7.2: Helper invited and can verify
- [ ] Phase 7.3–7.4: Helper cannot invite/revoke (authorization enforced)
- [ ] Phase 8: Cleanup successful

---

## Troubleshooting

- **Docker Compose fails to start:** Check `docker logs` for each service; ensure port 3000, 5432 are not in use.
- **Database migration errors:** Verify `DATABASE_URL` is set and Postgres is running; check for schema conflicts.
- **Crawler CLI not found:** Ensure ESM guard (`import.meta.url` check) is in place; rebuild Docker image.
- **Search returns no results:** Run crawler first (Phase 4); verify accounts are hydrated in `accounts` table.
- **ATProto record not visible:** Confirm org DID is correct; verify record was written via app logs.
- **Authorization failures:** Check session token validity; confirm org member role in `org_members` table.
