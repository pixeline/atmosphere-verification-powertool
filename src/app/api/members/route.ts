import { NextRequest, NextResponse } from 'next/server'
import { and, eq } from 'drizzle-orm'
import { db } from '../../../db/client'
import { members } from '../../../db/schema'
import { getActor } from '../../../lib/authz/session'
import { assertOwner, assertActiveMember, AuthzError } from '../../../lib/authz/membership'

function guard<T>(fn: () => Promise<T>) {
  return fn().catch((e) => {
    if (e instanceof AuthzError) return NextResponse.json({ error: e.message }, { status: e.status })
    throw e
  })
}

export async function POST(req: NextRequest) {
  return guard(async () => {
    const actor = await getActor(); if (!actor) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })
    const { orgId, handle, did } = await req.json()
    await assertOwner(actor.did, orgId)
    await db.insert(members).values({ orgId, memberDid: did, handle, role: 'helper', invitedByDid: actor.did })
      .onConflictDoUpdate({ target: [members.orgId, members.memberDid], set: { status: 'active', role: 'helper' } })
    return NextResponse.json({ ok: true })
  })
}
export async function GET(req: NextRequest) {
  return guard(async () => {
    const actor = await getActor(); if (!actor) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })
    const orgId = Number(req.nextUrl.searchParams.get('orgId'))
    await assertActiveMember(actor.did, orgId)
    const rows = await db.select().from(members).where(and(eq(members.orgId, orgId), eq(members.status, 'active')))
    return NextResponse.json({ members: rows })
  })
}
export async function DELETE(req: NextRequest) {
  return guard(async () => {
    const actor = await getActor(); if (!actor) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })
    const { orgId, memberDid } = await req.json()
    await assertOwner(actor.did, orgId)
    await db.update(members).set({ status: 'revoked' })
      .where(and(eq(members.orgId, orgId), eq(members.memberDid, memberDid)))
    return NextResponse.json({ ok: true })
  })
}
