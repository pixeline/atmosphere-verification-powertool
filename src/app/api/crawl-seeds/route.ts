import { NextRequest, NextResponse } from 'next/server'
import { count, eq } from 'drizzle-orm'
import { db } from '../../../db/client'
import { accounts, crawlSeeds } from '../../../db/schema'
import { getActor } from '../../../lib/authz/session'
import { assertActiveMember, AuthzError } from '../../../lib/authz/membership'
import { parseKeywords } from '../../../lib/keywords'

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
    const { orgId, keyword, keywords } = await req.json()
    await assertActiveMember(actor.did, orgId)
    // Accept a single `keyword` (legacy) or a `keywords` array/string, and split
    // any embedded commas/whitespace so a pasted list of cities becomes one seed
    // each. parseKeywords also de-dupes, keeping the upserts idempotent.
    const raw = Array.isArray(keywords) ? keywords : keywords != null ? [keywords] : []
    if (keyword != null) raw.push(keyword)
    const parsed = parseKeywords(raw.join(' '))
    for (const kw of parsed) {
      await db.insert(crawlSeeds).values({ keyword: kw, enabled: true })
        .onConflictDoUpdate({ target: crawlSeeds.keyword, set: { enabled: true } })
    }
    return NextResponse.json({ ok: true, added: parsed })
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
