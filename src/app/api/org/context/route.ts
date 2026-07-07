import { NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { db } from '../../../../db/client'
import { members, orgs } from '../../../../db/schema'
import { getActor } from '../../../../lib/authz/session'
import { isAllowlisted } from '../../../../lib/allowlist'

export async function GET() {
  const actor = await getActor()
  if (!actor) return NextResponse.json({ orgId: null }, { status: 401 })

  const rows = await db.select().from(members).where(eq(members.memberDid, actor.did))
  const active = rows.find((r) => r.status === 'active')

  const allowlisted = await isAllowlisted(actor.did)

  let handle: string | null = null
  if (active) {
    if (active.role === 'owner') {
      // An owner's display identity is the org's own handle.
      const orgRows = await db.select().from(orgs).where(eq(orgs.id, active.orgId))
      handle = orgRows[0]?.handle ?? active.handle ?? null
    } else {
      // A helper's handle is captured at invite time on the membership row.
      handle = active.handle ?? null
    }
  }

  return NextResponse.json({
    orgId: active?.orgId ?? null,
    role: active?.role ?? null,
    isAllowlisted: allowlisted,
    handle,
  })
}
