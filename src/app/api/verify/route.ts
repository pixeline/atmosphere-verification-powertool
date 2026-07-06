import { NextRequest, NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { db } from '../../../db/client'
import { orgs } from '../../../db/schema'
import { getActor } from '../../../lib/authz/session'
import { assertActiveMember, AuthzError } from '../../../lib/authz/membership'
import { verifyOne } from '../../../lib/verify/verifyService'

function guard<T>(fn: () => Promise<T>) {
  return fn().catch((e) => {
    if (e instanceof AuthzError) return NextResponse.json({ error: e.message }, { status: e.status })
    throw e
  })
}

export async function POST(req: NextRequest) {
  return guard(async () => {
    const actor = await getActor(); if (!actor) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })
    const { orgId, subjects } = await req.json()
    const cap = Number(process.env.VIDI_BATCH_MAX ?? 50)
    if (!Array.isArray(subjects) || subjects.length === 0) return NextResponse.json({ error: 'no_subjects' }, { status: 400 })
    if (subjects.length > cap) return NextResponse.json({ error: 'batch_too_large', cap }, { status: 400 })
    await assertActiveMember(actor.did, orgId)
    const [org] = await db.select().from(orgs).where(eq(orgs.id, orgId))
    if (!org) return NextResponse.json({ error: 'org_not_found' }, { status: 404 })
    if (org.status !== 'active') return NextResponse.json({ error: 'org_inactive' }, { status: 403 })
    const results = []
    for (const s of subjects) {
      const r = await verifyOne({ org: { id: org.id, did: org.did }, actorDid: actor.did, subject: s })
      results.push({ did: s.did, ...r })
    }
    return NextResponse.json({ results })
  })
}
