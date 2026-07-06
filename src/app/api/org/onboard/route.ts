import { NextResponse } from 'next/server'
import { db } from '../../../../db/client'
import { orgs, members } from '../../../../db/schema'
import { getActor } from '../../../../lib/authz/session'
import { isAllowlisted } from '../../../../lib/allowlist'
import { getOrgAgent } from '../../../../lib/atproto/orgAgent'

export async function POST() {
  const actor = await getActor()
  if (!actor) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })
  if (!(await isAllowlisted(actor.did))) {
    return NextResponse.json({ error: 'not_allowlisted' }, { status: 403 })
  }

  // Prove we hold the org writer session: the owner must have logged in AS
  // the org account, so its OAuth session is stored under actor.did.
  let agent, handle
  try {
    agent = await getOrgAgent(actor.did)
    const profile = await agent.getProfile({ actor: actor.did })
    handle = profile.data.handle
  } catch {
    return NextResponse.json({ error: 'no_org_session' }, { status: 400 })
  }

  const [org] = await db
    .insert(orgs)
    .values({
      did: actor.did,
      handle,
      status: 'active',
      scopes: 'atproto transition:generic',
      onboardedByDid: actor.did,
    })
    .onConflictDoUpdate({
      target: orgs.did,
      set: { handle, status: 'active' },
    })
    .returning()

  await db
    .insert(members)
    .values({ orgId: org.id, memberDid: actor.did, handle, role: 'owner' })
    .onConflictDoUpdate({
      target: [members.orgId, members.memberDid],
      set: { role: 'owner', status: 'active' },
    })

  return NextResponse.json({ ok: true, orgId: org.id })
}
