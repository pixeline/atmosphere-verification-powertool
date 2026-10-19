import { NextRequest, NextResponse } from 'next/server'
import { and, eq, inArray } from 'drizzle-orm'
import { db } from '../../../../db/client'
import { accounts, accountVerifications, backlogItems, orgs } from '../../../../db/schema'
import { getActor } from '../../../../lib/authz/session'
import { assertActiveMember, AuthzError } from '../../../../lib/authz/membership'
import { hydrateAccounts } from '../../../../crawler/hydrate'
import { getPublicAppViewAgent } from '../../../../lib/atproto/publicAgent'

function guard<T>(fn: () => Promise<T>) {
  return fn().catch((e) => {
    if (e instanceof AuthzError) return NextResponse.json({ error: e.message }, { status: e.status })
    throw e
  })
}

const DID_RE = /^did:(?:plc:[a-z2-7]{24}|web:[a-zA-Z0-9.:%-]+)$/
const CHUNK = 1000

function chunks<T>(xs: T[], n = CHUNK): T[][] {
  const out: T[][] = []
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n))
  return out
}

/**
 * Bulk-queue a list of DIDs (e.g. an uploaded CSV/TSV of self-declared
 * Belgians) into the org's To Be Verified backlog. Nothing is verified here —
 * this only stages accounts for human review. Subjects the org has already
 * verified are skipped, every remaining DID is re-resolved from the public
 * AppView (so the backlog shows current handle/bio, never client-supplied
 * data), and DIDs that no longer resolve (deleted/deactivated) are reported
 * back instead of queued. Re-importing is idempotent: existing backlog rows,
 * including ones a member already skipped, are left untouched.
 */
export async function POST(req: NextRequest) {
  return guard(async () => {
    const actor = await getActor(); if (!actor) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })
    const { orgId, dids } = await req.json()
    if (!Array.isArray(dids) || dids.length === 0) return NextResponse.json({ error: 'no_dids' }, { status: 400 })
    const cap = Number(process.env.VIDI_IMPORT_MAX ?? 5000)
    if (dids.length > cap) return NextResponse.json({ error: 'import_too_large', cap }, { status: 400 })
    await assertActiveMember(actor.did, orgId)
    const [org] = await db.select().from(orgs).where(eq(orgs.id, orgId))
    if (!org) return NextResponse.json({ error: 'org_not_found' }, { status: 404 })

    const unique = [...new Set(dids.filter((d): d is string => typeof d === 'string').map((d) => d.trim()))]
    const valid = unique.filter((d) => DID_RE.test(d))
    const invalid = unique.length - valid.length

    const verified = new Set<string>()
    for (const c of chunks(valid)) {
      const rows = await db
        .select({ subjectDid: accountVerifications.subjectDid })
        .from(accountVerifications)
        .where(and(eq(accountVerifications.verifierDid, org.did), inArray(accountVerifications.subjectDid, c)))
      for (const r of rows) verified.add(r.subjectDid)
    }
    const candidates = valid.filter((d) => !verified.has(d))

    // Refresh profiles from the network, then trust only what landed in our index.
    await hydrateAccounts(getPublicAppViewAgent(), candidates, 'import')
    const found = new Set<string>()
    for (const c of chunks(candidates)) {
      const rows = await db.select({ did: accounts.did }).from(accounts).where(inArray(accounts.did, c))
      for (const r of rows) found.add(r.did)
    }
    const toQueue = candidates.filter((d) => found.has(d))

    let queued = 0
    for (const c of chunks(toQueue)) {
      const inserted = await db
        .insert(backlogItems)
        .values(c.map((subjectDid) => ({ orgId, subjectDid, addedByDid: actor.did, status: 'pending' })))
        .onConflictDoNothing()
        .returning({ subjectDid: backlogItems.subjectDid })
      queued += inserted.length
    }

    return NextResponse.json({
      queued,
      alreadyInBacklog: toQueue.length - queued,
      alreadyVerified: verified.size,
      notFound: candidates.length - toQueue.length,
      invalid,
    })
  })
}
