import { NextRequest, NextResponse } from 'next/server'
import { and, eq, inArray } from 'drizzle-orm'
import { db } from '../../../db/client'
import { accounts, accountVerifications, backlogItems, orgs, trustedVerifiers } from '../../../db/schema'
import { getActor } from '../../../lib/authz/session'
import { assertActiveMember, AuthzError } from '../../../lib/authz/membership'
import { upsertAccountRow } from '../../../crawler/hydrate'
import { isCustomDomain } from '../../../lib/domain/handleClassifier'
import { getPublicAppViewAgent } from '../../../lib/atproto/publicAgent'

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

    const rows = await db
      .select({
        subjectDid: backlogItems.subjectDid,
        note: backlogItems.note,
        handle: accounts.handle,
        displayName: accounts.displayName,
        description: accounts.description,
        isCustomDomain: accounts.isCustomDomain,
        followersCount: accounts.followersCount,
        followsCount: accounts.followsCount,
        lastActiveAt: accounts.lastActiveAt,
      })
      .from(backlogItems)
      .leftJoin(accounts, eq(backlogItems.subjectDid, accounts.did))
      .where(and(eq(backlogItems.orgId, orgId), eq(backlogItems.status, 'pending')))

    const dids = rows.map((r) => r.subjectDid)
    const verifiersByDid = new Map<string, { did: string; handle: string | null }[]>()
    if (dids.length) {
      const verifierRows = await db
        .select({
          subjectDid: accountVerifications.subjectDid,
          verifierDid: accountVerifications.verifierDid,
          tvHandle: trustedVerifiers.handle,
          orgHandle: orgs.handle,
        })
        .from(accountVerifications)
        .leftJoin(trustedVerifiers, eq(accountVerifications.verifierDid, trustedVerifiers.did))
        .leftJoin(orgs, eq(accountVerifications.verifierDid, orgs.did))
        .where(inArray(accountVerifications.subjectDid, dids))

      for (const row of verifierRows) {
        const list = verifiersByDid.get(row.subjectDid) ?? []
        list.push({ did: row.verifierDid, handle: row.tvHandle ?? row.orgHandle ?? null })
        verifiersByDid.set(row.subjectDid, list)
      }
    }

    const items = rows.map((r) => ({ ...r, verifiers: verifiersByDid.get(r.subjectDid) ?? [] }))
    return NextResponse.json({ items })
  })
}

export async function POST(req: NextRequest) {
  return guard(async () => {
    const actor = await getActor(); if (!actor) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })
    const { orgId, subjectDid, note, handle } = await req.json()
    await assertActiveMember(actor.did, orgId)
    if (handle) {
      // `handle` presence is only a client hint that this subject isn't
      // indexed yet (a live-search result) — its VALUE is never trusted.
      // Re-resolving from the network (mirroring verifyService's identity
      // resolution) prevents an active member from poisoning another DID's
      // cached handle/displayName, which verifyService treats as
      // authoritative for on-chain verification records. Skipped entirely
      // if the subject is already indexed, so this path only ever fills a
      // gap — it never overwrites existing account data.
      try {
        const existing = await db.select().from(accounts).where(eq(accounts.did, subjectDid))
        if (!existing[0]) {
          const prof = await getPublicAppViewAgent().getProfile({ actor: subjectDid })
          await upsertAccountRow({
            did: subjectDid,
            handle: prof.data.handle,
            displayName: prof.data.displayName ?? null,
            description: prof.data.description ?? null,
            avatar: prof.data.avatar ?? null,
            isCustomDomain: isCustomDomain(prof.data.handle),
            seedSource: 'backlog',
            followersCount: prof.data.followersCount ?? null,
            followsCount: prof.data.followsCount ?? null,
          })
        }
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
