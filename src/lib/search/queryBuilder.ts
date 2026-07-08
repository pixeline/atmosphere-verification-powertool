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
