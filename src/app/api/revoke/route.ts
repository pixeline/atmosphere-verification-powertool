import { NextRequest, NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { db } from '../../../db/client'
import { orgs } from '../../../db/schema'
import { getActor } from '../../../lib/authz/session'
import { assertActiveMember, AuthzError } from '../../../lib/authz/membership'
import { revokeOne } from '../../../lib/verify/verifyService'

function guard<T>(fn: () => Promise<T>) {
  return fn().catch((e) => {
    if (e instanceof AuthzError) return NextResponse.json({ error: e.message }, { status: e.status })
    throw e
  })
}

export async function POST(req: NextRequest) {
  return guard(async () => {
    const actor = await getActor(); if (!actor) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })
    const { orgId, subjectDid } = await req.json()
    await assertActiveMember(actor.did, orgId)
    const [org] = await db.select().from(orgs).where(eq(orgs.id, orgId))
    if (!org) return NextResponse.json({ error: 'org_not_found' }, { status: 404 })
    if (org.status !== 'active') return NextResponse.json({ error: 'org_inactive' }, { status: 403 })
    const outcome = await revokeOne({ org: { id: org.id, did: org.did }, actorDid: actor.did, subjectDid })
    return NextResponse.json({ outcome })
  })
}
