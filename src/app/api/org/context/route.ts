import { NextResponse } from 'next/server'
import { count, eq } from 'drizzle-orm'
import { db } from '../../../../db/client'
import { accountVerifications, members, orgs } from '../../../../db/schema'
import { getActor } from '../../../../lib/authz/session'
import { isAllowlisted } from '../../../../lib/allowlist'
import { countOrgVerifications } from '../../../../lib/verify/verifiedCount'

export async function GET() {
  const actor = await getActor()
  if (!actor) return NextResponse.json({ orgId: null }, { status: 401 })

  const rows = await db.select().from(members).where(eq(members.memberDid, actor.did))
  const active = rows.find((r) => r.status === 'active')

  const allowlisted = await isAllowlisted(actor.did)

  let handle: string | null = null
  let verifiedCount: number | null = null
  if (active) {
    const orgRows = await db.select().from(orgs).where(eq(orgs.id, active.orgId))
    const org = orgRows[0]
    // An owner's display identity is the org's own handle; a helper's handle
    // is captured at invite time on the membership row.
    handle = active.role === 'owner' ? (org?.handle ?? active.handle ?? null) : (active.handle ?? null)
    if (org) {
      // The live on-network record count is the true total (includes accounts
      // verified directly on Bluesky/mu, not just via Vidi). Fall back to the
      // locally-crawled count if the network read fails so the header still
      // shows a sensible number.
      try {
        verifiedCount = await countOrgVerifications(org.did)
      } catch {
        const countRows = await db
          .select({ value: count() })
          .from(accountVerifications)
          .where(eq(accountVerifications.verifierDid, org.did))
        verifiedCount = countRows[0]?.value ?? 0
      }
    }
  }

  return NextResponse.json({
    orgId: active?.orgId ?? null,
    role: active?.role ?? null,
    isAllowlisted: allowlisted,
    handle,
    verifiedCount,
  })
}
