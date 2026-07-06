import { NextRequest, NextResponse } from 'next/server'
import { getActor } from '../../../../lib/authz/session'
import { isSuperadmin, addToAllowlist, isAllowlisted } from '../../../../lib/allowlist'

export async function POST(req: NextRequest) {
  const actor = await getActor()
  if (!actor || !isSuperadmin(actor.did)) return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  const { did, handle } = await req.json()
  await addToAllowlist(did, handle, actor.did)
  return NextResponse.json({ ok: true })
}

export async function GET(req: NextRequest) {
  const did = req.nextUrl.searchParams.get('did') ?? ''
  return NextResponse.json({ allowlisted: await isAllowlisted(did) })
}
