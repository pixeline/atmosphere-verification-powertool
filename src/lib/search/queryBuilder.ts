import { and, or, ilike, eq, inArray, exists, type SQL } from 'drizzle-orm'
import { db } from '../../db/client'
import { accounts, accountVerifications, accountSignals } from '../../db/schema'

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
