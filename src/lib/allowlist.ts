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
