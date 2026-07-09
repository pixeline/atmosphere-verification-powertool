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
    // Deliberate: normal SQL null semantics mean accounts.lastActiveAt IS NULL
    // (not yet checked by a refreshLastActive crawl pass) is excluded from
    // every "Active within" bucket, rather than assumed active. This is
    // correct — activity is genuinely unknown for those rows — and
    // self-limiting, since refreshLastActive picks up any account whose
    // last_active_checked_at is null (or stale) on its very next pass. The
    // default "Any time" filter (activeWithinDays: null) is unaffected, as
    // this whole condition is skipped when the filter isn't set.
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
