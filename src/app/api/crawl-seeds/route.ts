import { NextRequest, NextResponse } from 'next/server'
import { count, eq } from 'drizzle-orm'
import { db } from '../../../db/client'
import { accounts, crawlSeeds } from '../../../db/schema'
import { getActor } from '../../../lib/authz/session'
import { assertActiveMember, AuthzError } from '../../../lib/authz/membership'

function guard<T>(fn: () => Promise<T>) {
  return fn().catch((e) => {
    if (e instanceof AuthzError) return NextResponse.json({ error: e.message }, { status: e.status })
    throw e
  })
}

export async function GET(req: NextRequest) {
  return guard(async () => {
    const actor = await getActor(); if (!actor) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })
    const url = new URL(req.url)
    const orgId = Number(url.searchParams.get('orgId'))
    await assertActiveMember(actor.did, orgId)
    const seeds = await db.select().from(crawlSeeds)
    // Total harvested accounts — the pool these keywords feed into. Surfaced in
    // the Settings UI so members understand what the keyword setting affects.
    const [{ value: accountsCount }] = await db.select({ value: count() }).from(accounts)
    return NextResponse.json({ seeds, accountsCount })
  })
}

export async function POST(req: NextRequest) {
  return guard(async () => {
    const actor = await getActor(); if (!actor) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })
    const { orgId, keyword } = await req.json()
    await assertActiveMember(actor.did, orgId)
    await db.insert(crawlSeeds).values({ keyword, enabled: true })
      .onConflictDoUpdate({ target: crawlSeeds.keyword, set: { enabled: true } })
    return NextResponse.json({ ok: true })
  })
}

export async function PATCH(req: NextRequest) {
  return guard(async () => {
    const actor = await getActor(); if (!actor) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })
    const { orgId, keyword, enabled } = await req.json()
    await assertActiveMember(actor.did, orgId)
    await db.update(crawlSeeds).set({ enabled }).where(eq(crawlSeeds.keyword, keyword))
    return NextResponse.json({ ok: true })
  })
}
