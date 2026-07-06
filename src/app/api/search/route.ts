import { NextRequest, NextResponse } from 'next/server'
import { getActor } from '../../../lib/authz/session'
import { assertActiveMember, AuthzError } from '../../../lib/authz/membership'
import { searchAccounts } from '../../../lib/search/queryBuilder'

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
  return NextResponse.json({ results })
}
