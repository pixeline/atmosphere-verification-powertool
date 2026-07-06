import { NextRequest, NextResponse } from 'next/server'
import { eq, inArray } from 'drizzle-orm'
import { getActor } from '../../../lib/authz/session'
import { assertActiveMember, AuthzError } from '../../../lib/authz/membership'
import { searchAccounts } from '../../../lib/search/queryBuilder'
import { db } from '../../../db/client'
import { accountVerifications, trustedVerifiers } from '../../../db/schema'

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
  const dids = results.map((r) => r.did)

  const verifiersByDid = new Map<string, Verifier[]>()
  if (dids.length) {
    const rows = await db
      .select({
        subjectDid: accountVerifications.subjectDid,
        verifierDid: accountVerifications.verifierDid,
        handle: trustedVerifiers.handle,
      })
      .from(accountVerifications)
      .leftJoin(trustedVerifiers, eq(accountVerifications.verifierDid, trustedVerifiers.did))
      .where(inArray(accountVerifications.subjectDid, dids))

    for (const row of rows) {
      const list = verifiersByDid.get(row.subjectDid) ?? []
      list.push({ did: row.verifierDid, handle: row.handle ?? null })
      verifiersByDid.set(row.subjectDid, list)
    }
  }

  return NextResponse.json({
    results: results.map((r) => ({ ...r, verifiers: verifiersByDid.get(r.did) ?? [] })),
  })
}
