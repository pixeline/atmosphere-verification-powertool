import { NextRequest, NextResponse } from 'next/server'
import { and, eq } from 'drizzle-orm'
import { db } from '../../../db/client'
import { backlogItems } from '../../../db/schema'
import { getActor } from '../../../lib/authz/session'
import { assertActiveMember, AuthzError } from '../../../lib/authz/membership'
import { upsertAccountRow } from '../../../crawler/hydrate'
import { isCustomDomain } from '../../../lib/domain/handleClassifier'

function guard<T>(fn: () => Promise<T>) {
  return fn().catch((e) => {
    if (e instanceof AuthzError) return NextResponse.json({ error: e.message }, { status: e.status })
    throw e
  })
}

export async function GET(req: NextRequest) {
  return guard(async () => {
    const actor = await getActor(); if (!actor) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })
    const orgId = Number(req.nextUrl.searchParams.get('orgId'))
    await assertActiveMember(actor.did, orgId)
    const rows = await db.select().from(backlogItems).where(and(eq(backlogItems.orgId, orgId), eq(backlogItems.status, 'pending')))
    return NextResponse.json({ items: rows })
  })
}

export async function POST(req: NextRequest) {
  return guard(async () => {
    const actor = await getActor(); if (!actor) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })
    const { orgId, subjectDid, note, handle, displayName, description, isCustomDomain: isDomain } = await req.json()
    await assertActiveMember(actor.did, orgId)
    if (handle) {
      // Best-effort cache write — must never block adding to the backlog,
      // the same reasoning applied to verifyService's live-fallback upsert.
      try {
        await upsertAccountRow({
          did: subjectDid,
          handle,
          displayName: displayName ?? null,
          description: description ?? null,
          avatar: null,
          isCustomDomain: isDomain ?? isCustomDomain(handle),
          seedSource: 'backlog',
        })
      } catch (e) {
        console.error('backlog: failed to upsert account row', e)
      }
    }
    await db.insert(backlogItems).values({ orgId, subjectDid, note, addedByDid: actor.did, status: 'pending' })
      .onConflictDoUpdate({ target: [backlogItems.orgId, backlogItems.subjectDid], set: { status: 'pending', note } })
    return NextResponse.json({ ok: true })
  })
}

export async function PATCH(req: NextRequest) {
  return guard(async () => {
    const actor = await getActor(); if (!actor) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })
    const { orgId, subjectDid, status } = await req.json()
    await assertActiveMember(actor.did, orgId)
    await db.update(backlogItems).set({ status })
      .where(and(eq(backlogItems.orgId, orgId), eq(backlogItems.subjectDid, subjectDid)))
    return NextResponse.json({ ok: true })
  })
}
