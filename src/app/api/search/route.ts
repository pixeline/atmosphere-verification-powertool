import { NextRequest, NextResponse } from 'next/server'
import { eq, inArray } from 'drizzle-orm'
import { getActor } from '../../../lib/authz/session'
import { assertActiveMember, AuthzError } from '../../../lib/authz/membership'
import { searchAccounts } from '../../../lib/search/queryBuilder'
import { searchActorsLive, type LiveActor } from '../../../lib/search/liveSearch'
import { db } from '../../../db/client'
import { accountVerifications, trustedVerifiers, orgs } from '../../../db/schema'

export type Verifier = { did: string; handle: string | null }

export async function POST(req: NextRequest) {
  const actor = await getActor()
  if (!actor) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })
  const { orgId, filters } = await req.json()
  try {
    await assertActiveMember(actor.did, orgId)
  } catch (e) {
    if (e instanceof AuthzError) return NextResponse.json({ error: e.message }, { status: e.status })
    throw e
  }

  const results = await searchAccounts(filters ?? {})

  let liveResults: LiveActor[] = []
  if (filters?.liveNetwork && filters?.text) {
    try {
      liveResults = await searchActorsLive(filters.text, 25)
    } catch (err) {
      console.error('search: live network search failed', err)
    }
    if (filters.customDomainOnly) {
      liveResults = liveResults.filter((a) => a.isCustomDomain)
    }
  }

  const localDids = new Set(results.map((r) => r.did))
  const liveOnly = liveResults.filter((a) => !localDids.has(a.did))
  const combined = [
    ...results.map((r) => ({ ...r, indexed: true as const })),
    ...liveOnly.map((a) => ({ ...a, indexed: false as const })),
  ]

  const allDids = combined.map((r) => r.did)
  const verifiersByDid = new Map<string, Verifier[]>()
  if (allDids.length) {
    const rows = await db
      .select({
        subjectDid: accountVerifications.subjectDid,
        verifierDid: accountVerifications.verifierDid,
        // Prefer Mu's official trusted-verifier list (when configured); fall
        // back to our own onboarded org handle, since a self-verifying org
        // won't appear on that externally-sourced list until Mu adds it.
        tvHandle: trustedVerifiers.handle,
        orgHandle: orgs.handle,
      })
      .from(accountVerifications)
      .leftJoin(trustedVerifiers, eq(accountVerifications.verifierDid, trustedVerifiers.did))
      .leftJoin(orgs, eq(accountVerifications.verifierDid, orgs.did))
      .where(inArray(accountVerifications.subjectDid, allDids))

    for (const row of rows) {
      const list = verifiersByDid.get(row.subjectDid) ?? []
      list.push({ did: row.verifierDid, handle: row.tvHandle ?? row.orgHandle ?? null })
      verifiersByDid.set(row.subjectDid, list)
    }
  }

  return NextResponse.json({
    results: combined.map((r) => ({ ...r, verifiers: verifiersByDid.get(r.did) ?? [] })),
  })
}
