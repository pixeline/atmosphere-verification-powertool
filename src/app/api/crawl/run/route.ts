import { NextRequest, NextResponse } from 'next/server'
import { getActor } from '../../../../lib/authz/session'
import { assertOwner, AuthzError } from '../../../../lib/authz/membership'
import { db } from '../../../../db/client'
import { crawlRequests } from '../../../../db/schema'

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
    // The crawl must NOT run in the web-server process (a crash there takes the
    // whole site down). Enqueue a request; the out-of-process `worker` container
    // (src/crawler/scheduler.ts) claims and runs it.
    await db.insert(crawlRequests).values({ requestedByDid: actor.did })
    return NextResponse.json({ ok: true, queued: true })
  })
}
