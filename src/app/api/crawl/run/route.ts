import { NextRequest, NextResponse } from 'next/server'
import { getActor } from '../../../../lib/authz/session'
import { assertOwner, AuthzError } from '../../../../lib/authz/membership'
import { runCrawl } from '../../../../crawler/run'

function guard<T>(fn: () => Promise<T>) {
  return fn().catch((e) => {
    if (e instanceof AuthzError) return NextResponse.json({ error: e.message }, { status: e.status })
    throw e
  })
}

export async function POST(req: NextRequest) {
  return guard(async () => {
    const actor = await getActor(); if (!actor) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })
    const { orgId } = await req.json()
    await assertOwner(actor.did, orgId)
    // Fire-and-forget: a full crawl can take minutes. Vidi runs as a long-lived
    // Node process (next start in Docker), not serverless, so this async call
    // keeps running after the response is sent — the same execution model the
    // scheduled worker process already relies on to run runCrawl() unattended.
    runCrawl().catch((err) => console.error('crawl/run: manual trigger failed', err))
    return NextResponse.json({ ok: true, started: true })
  })
}
