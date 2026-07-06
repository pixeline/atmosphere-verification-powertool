import { and, eq } from 'drizzle-orm'
import { db } from '../../db/client'
import { members } from '../../db/schema'

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
