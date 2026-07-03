# Vidi — Trusted Verifier Powertool

**Status:** Design approved (pending written review)
**Date:** 2026-07-03
**Author:** Alexandre Plennevaux (with Claude)

> **Vidi** (Latin, *"I have seen"*) is a multi-tenant web tool that lets Trusted
> Verifiers on the Mu AppView (mu.social, by Eurosky / Stichting Modal) discover
> accounts by rich criteria and verify them — directly or via a shared backlog —
> with delegated helpers acting as the org under a full audit trail.

---

## 1. Purpose

On Mu, a **Trusted Verifier (TV)** can attest that an account is who it claims to
be. Today that happens one profile at a time through Mu's web UI (the three-dots
menu → "Verify account"). Vidi turns that into a real workflow: **search** the
network for accounts matching curated criteria, then **verify** them in bulk or
**queue** them for review — and lets a TV **delegate** verification to invited
helpers without handing over its account.

### Goals
- Search accounts by composable criteria (see §7).
- Verify / revoke accounts on Mu directly from the tool.
- A shared "To Be Verified" backlog per org.
- Delegation: an org owner invites helpers who verify *as the org*; helpers
  cannot invite; owner can revoke instantly.
- Multi-tenant: any TV on a maintained allowlist can onboard and use the tool.
- Full audit trail of who did what.

### Non-goals (v1)
- No native mobile app (responsive web only).
- No per-verification "expertise/special-category" tagging (the atproto
  verification record has no such field; Mu handles categories elsewhere).
- No exhaustive real-time social-graph queries (the "followed by a verified
  account" signal is crawl-derived, refreshed periodically).
- Not open to the general public — allowlisted TVs only.

---

## 2. Key technical findings (validated against Eurosky's fork)

Investigated `eurosky-social/eurosky-social-app` and `eurosky-social/u-at-proto`:

- **Verification is a standard atproto record.** Mu uses the plain
  `app.bsky.graph.verification` lexicon. `useVerificationCreateMutation` writes it
  via the atproto agent; `useVerificationsRemoveMutation` deletes it by `AtUri`.
  → **Verify and revoke are normal authenticated atproto writes**
  (`com.atproto.repo.createRecord` / `deleteRecord`). No private Mu API needed.
- **A verification counts only if it lives in the verifier's own repo**, signed by
  the verifier's DID. → To "verify as the org," the write must be made **as the
  org identity** (this is the root of the delegation design, §5).
- **The trusted-verifier set is itself atproto lists** (`TRUSTED_VERIFIER_LIST_URIS`
  → `fetchTrustedVerifierDids`). → We can resolve those lists to DIDs and read each
  verifier's public repo to learn exactly who they've verified (§8).
- **Verification records are public** (stored on PDSs), so the entire "who verified
  whom" graph is readable without special access.

---

## 3. Core concept: actor vs. writer

Two identities flow through the system; keeping them separate *is* the security model.

- **Actor** — the logged-in human (owner or helper), authenticated by *their own*
  atproto OAuth. Used only for **authorization** and **audit** ("who clicked verify").
- **Writer** — the **org** (e.g. `atproto-belgium.eurosky.social`), whose stored
  OAuth token signs the actual `app.bsky.graph.verification` record. Every write is
  performed as the org but **attributed to an actor** in Vidi's audit log.

---

## 4. Architecture & deployment

Runs on the user's **pixeline VPS via Docker Compose**, served at
**`https://belgium-atmosphe.re/vidi`** (a subpath, not a subdomain). TypeScript
throughout so we use the maintained `@atproto/api` + `@atproto/oauth-client-node`
(which own PAR, PKCE-S256, DPoP, and refresh-token rotation — the security-critical
parts we do not want to hand-roll).

### Subpath hosting implications
- Next.js runs with `basePath: '/vidi'` (and matching `assetPrefix`).
- OAuth `client_id` = `https://belgium-atmosphe.re/vidi/client-metadata.json`;
  redirect URIs live under `/vidi`. TLS is mandatory (Caddy provisions it).
- Caddy routes `belgium-atmosphe.re/vidi*` → the `app` container.

### Compose services
- **`app`** — Next.js (App Router) serving UI + `/api` routes + the OAuth
  `client-metadata.json`. Runs with `next start` (Node runtime).
- **`worker`** — the crawler/indexer + scheduler (its own process; a client-server
  DB means it can write concurrently with `app`, no lock coupling).
- **`db`** — **PostgreSQL** (chosen for `pg_trgm` GIN indexes → fast arbitrary
  substring search over bio/handle, incl. emoji and TLD fragments).
- **`caddy`** — reverse proxy terminating TLS (needed: OAuth `client_id` must be a
  stable HTTPS URL).

```
Internet ──▶ caddy (TLS) ──▶ app (Next.js: UI, /api, /client-metadata.json)
                                  │
              worker (crawl+cron) │  both ──▶ db (Postgres, pg_trgm)
                                  ▼
                    @atproto/api ──▶ Mu / atproto network (PDS, appview, PLC)
```

### Stack
- Next.js + TypeScript (`basePath: '/vidi'`), React UI.
- `@atproto/api`, `@atproto/oauth-client-node`.
- PostgreSQL; access via a typed query layer (Drizzle or Prisma — decide in plan).
- Scheduler: in-worker cron (e.g. `node-cron`) or host cron hitting an internal
  authenticated endpoint (decide in plan).

### CI/CD (GitHub Actions → pixeline VPS)
On push to `main`:
1. Build the app image.
2. Push to **GHCR** (`ghcr.io`).
3. **SSH** into the pixeline VPS with a dedicated deploy key and run
   `docker compose pull && docker compose up -d`.
4. Run DB migrations as a pipeline step.

- **GitHub secrets:** SSH deploy key + host only.
- **Runtime secrets** (token-encryption key, OAuth private JWK, Postgres creds)
  live in an `.env` file **on the VPS**, managed out-of-band — never in the repo or
  CI. The VPS runs containers only (no build tooling).

---

## 5. Authentication & delegation

### Org onboarding (once per TV)
1. An allowlisted TV's **owner** logs in via atproto OAuth **as the org account**,
   granting write scope (`atproto` + `transition:generic`).
2. Vidi stores the org's **refresh token encrypted at rest** (envelope encryption;
   key from env/secret, never in DB plaintext).
3. The backend mints short-lived access tokens (with DPoP) on demand to write/revoke.
4. If the refresh token expires/revokes → owner is prompted to re-consent; writes
   pause, curation continues.

### Helper login
- Helper logs in with **their own** handle via atproto OAuth.
- Their DID is matched against `members`; an active membership authorizes them and
  stamps every action in the audit log.

### Roles & permissions
| Role | Maintain allowlist | Onboard org token | Invite/revoke helpers | Verify/revoke | Curate backlog |
|------|:--:|:--:|:--:|:--:|:--:|
| **superadmin** (Vidi maintainer) | ✅ | — | — | — | — |
| **org owner** | — | ✅ | ✅ (own org) | ✅ | ✅ |
| **helper** | — | — | ❌ | ✅ | ✅ |

- Revoking a helper flips membership status → their sessions stop being authorized
  immediately; any write returns 403.

### Allowlist
- `trusted_verifier_allowlist` is **maintained by Vidi's superadmin** (seedable from
  Mu's `TRUSTED_VERIFIER_LIST_URIS`, but Vidi controls the final list).
- Only a DID present + enabled in the allowlist may onboard as an org.

---

## 6. Data model (PostgreSQL)

**Global (shared across orgs — public data):**
- `accounts` — the crawled index: `did`, `handle`, `display_name`, `description`
  (bio), `avatar`, `is_custom_domain` (derived), `indexed_at`, `seed_source`.
  `pg_trgm` GIN indexes on `handle` and `description`.
- `account_verifications` — `subject_did`, `verifier_did`, `record_uri`,
  `created_at`. Who verified whom (from crawling TV repos + orgs' own writes).
- `account_signals` — `subject_did`, `followed_by_verified` (bool), plus which
  verified accounts follow them.
- `trusted_verifiers` — cached TV set: `did`, `handle`, `source_list_uri`.
- `crawl_runs` — cursors + bookkeeping for the crawler.

**Tenant registry (superadmin / onboarding):**
- `trusted_verifier_allowlist` — `did`, `handle`, `enabled`, `added_by`, `added_at`.
  Superadmin-maintained gate on who may onboard.
- `orgs` — `id`, `did`, `handle`, encrypted `access`/`refresh` tokens, `scopes`,
  `token_expiry`, `status`, `onboarded_by_did`. One row per onboarded TV.

**Org-scoped (per-org operational data):**
- `members` — `org_id`, `member_did`, `handle`, `role` (`owner`/`helper`),
  `status` (`active`/`revoked`), `invited_by_did`, `added_at`.
- `backlog_items` — `org_id`, `subject_did`, `status`
  (`pending`/`verified`/`skipped`/`removed`), `added_by_did`, `note`, timestamps.
  Shared team queue within an org.
- `verification_actions` — audit log: `org_id`, `actor_did`, `action`
  (`verify`/`revoke`), `subject_did`, `record_uri`, `outcome`, `created_at`.

---

## 7. Search (over the local index)

Composable filters, all AND-combinable:

1. **String in bio/handle** — substring match via `pg_trgm` (`ILIKE '%x%'`),
   indexed. Emoji and TLD fragments work (they're just Unicode substrings).
2. **Handle is a domain** — `is_custom_domain` = handle not under a
   platform-provided suffix (`*.bsky.social`, `*.mu.social`, `*.eurosky.social`, …).
3. **Verified by selected TVs** — join `account_verifications` where `verifier_did`
   ∈ the TVs the user checked for that search (selectable per search).
4. **Followed by a verified account** — the crawl-derived `followed_by_verified`
   signal.

Result cards show profile + which filters matched + current verification state
(already verified by this org? by which other TVs?). Multi-select →
**Verify now** or **Add to backlog**.

---

## 8. Crawler / indexer (worker, periodic + incremental)

1. Resolve `TRUSTED_VERIFIER_LIST_URIS` → TV DIDs → cache in `trusted_verifiers`.
2. For each TV: `listRecords` on `app.bsky.graph.verification` → upsert
   `account_verifications` + index those subjects.
3. **Backwards signal (the key trick):** take verified accounts + TVs and enumerate
   their `getFollows`; mark those follows `followed_by_verified` and index them.
   (Computing the signal forwards from strangers would be unbounded; seeding from
   known verified accounts makes it a bounded crawl.)
4. **Keyword seed:** run `searchActors` for configured terms → index results.
5. **Hydrate** profiles in batches (`getProfiles`) for bio/handle/displayName/avatar.

Uses cursors for incrementality; exponential backoff on rate limits; each run
recorded in `crawl_runs`.

---

## 9. Verify / revoke flows

**Verify (single or batch):**
1. Authz: actor is an active member of the org.
2. Guardrails: skip if the org already verified the subject (**dedupe**); skip if
   the subject is on Mu's verification **denylist**; snapshot subject `handle` +
   `displayName`.
3. Load org OAuth session (refresh → access token, DPoP) and
   `createRecord` `app.bsky.graph.verification` `{ subject, handle, displayName,
   createdAt }` in the org repo.
4. Write `verification_actions` audit row; update `accounts`/`account_verifications`
   + any `backlog_items` → `verified`.
5. Batch: per-item outcome (`verified` / `skipped-duplicate` / `skipped-denylist` /
   `error`); capped per run to respect rate limits.

**Revoke:** look up the org's `record_uri` → `deleteRecord` → audit row.

---

## 10. Error handling

- **Org token expiry/revocation** → banner prompting owner re-auth; writes pause,
  curation still works.
- **Rate limits** → exponential backoff; batches resumable via per-item status.
- **Revoked member** → 403 on any write attempt.
- **Partial batch failure** → reported per-account, never silently dropped.

---

## 11. Security considerations

- Org refresh tokens **encrypted at rest**; encryption key from env/secret, rotated
  independently of the DB.
- Confidential OAuth client; `client_id` =
  `https://belgium-atmosphe.re/vidi/client-metadata.json` (stable HTTPS).
- Strict actor/writer separation; every org write attributed to an actor DID.
- Allowlist gate on onboarding; helper authz re-checked on every write.
- DPoP-bound tokens (handled by `@atproto/oauth-client-node`).

---

## 12. Testing

- **Unit:** custom-domain classifier; search filter/query builder; dedupe + denylist
  guardrails; token encryption round-trip.
- **Integration:** create/delete verification against a mocked atproto agent;
  crawler against fixture repos; OAuth flow against a test authorization server.
- **Authz:** helper-cannot-invite; revoked-member-blocked; non-allowlisted-DID
  cannot onboard; actor-vs-writer attribution correct.

---

## 13. v1 scope / YAGNI

- Multi-tenant from day one (allowlist-gated), but UI can start minimal.
- No expertise/category tagging, no native app, no real-time graph queries.
- Batch verify capped per run.

## 14. Open questions for the implementation plan
- Query layer: Drizzle vs Prisma.
- Scheduler: in-worker `node-cron` vs host cron → internal endpoint.
- Keyword-seed list: static config vs superadmin-editable.
- Allowlist management: seed/config file vs minimal superadmin UI for v1.
