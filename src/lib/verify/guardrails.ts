import { and, eq } from 'drizzle-orm'
import { db } from '../../db/client'
import { accountVerifications } from '../../db/schema'
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
