import { NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { db } from '../../../../db/client'
import { members } from '../../../../db/schema'
import { getActor } from '../../../../lib/authz/session'

export async function GET() {
  const actor = await getActor()
  if (!actor) return NextResponse.json({ orgId: null }, { status: 401 })
  const rows = await db.select().from(members).where(eq(members.memberDid, actor.did))
  const active = rows.find((r) => r.status === 'active')
  return NextResponse.json({ orgId: active?.orgId ?? null, role: active?.role ?? null })
}
