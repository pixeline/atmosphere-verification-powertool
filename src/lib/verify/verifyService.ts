import { and, eq } from 'drizzle-orm'
import { db } from '../../db/client'
import { accountVerifications, verificationActions } from '../../db/schema'
import { getOrgAgent } from '../atproto/orgAgent'
import { checkGuards } from './guardrails'

type Org = { id: number; did: string }

async function audit(orgId: number, actorDid: string, action: 'verify' | 'revoke', subjectDid: string, outcome: string, recordUri?: string) {
  await db.insert(verificationActions).values({ orgId, actorDid, action, subjectDid, outcome, recordUri })
}

export async function verifyOne(p: { org: Org; actorDid: string; subject: { did: string; handle: string; displayName?: string } }) {
  const guard = await checkGuards(p.org.did, p.subject.did)
  if (!guard.ok) {
    const outcome = guard.reason === 'denylist' ? ('skipped-denylist' as const) : ('skipped-duplicate' as const)
    await audit(p.org.id, p.actorDid, 'verify', p.subject.did, outcome)
    return { outcome }
  }
  try {
    const agent = await getOrgAgent(p.org.did)
    const createdAt = new Date().toISOString()
    const { data } = await agent.com.atproto.repo.createRecord({
      repo: p.org.did,
      collection: 'app.bsky.graph.verification',
      record: { subject: p.subject.did, handle: p.subject.handle, displayName: p.subject.displayName ?? '', createdAt },
    })
    await db
      .insert(accountVerifications)
      .values({ subjectDid: p.subject.did, verifierDid: p.org.did, recordUri: data.uri, createdAt: new Date(createdAt) })
      .onConflictDoUpdate({ target: [accountVerifications.subjectDid, accountVerifications.verifierDid], set: { recordUri: data.uri } })
    await audit(p.org.id, p.actorDid, 'verify', p.subject.did, 'verified', data.uri)
    return { outcome: 'verified' as const, recordUri: data.uri }
  } catch (e) {
    await audit(p.org.id, p.actorDid, 'verify', p.subject.did, 'error')
    return { outcome: 'error' as const }
  }
}

export async function revokeOne(p: { org: Org; actorDid: string; subjectDid: string }) {
  try {
    const rows = await db
      .select()
      .from(accountVerifications)
      .where(and(eq(accountVerifications.verifierDid, p.org.did), eq(accountVerifications.subjectDid, p.subjectDid)))
    if (!rows[0]) return { outcome: 'error' as const }
    const uri = rows[0].recordUri
    const rkey = uri.split('/').pop()!
    const agent = await getOrgAgent(p.org.did)
    await agent.com.atproto.repo.deleteRecord({ repo: p.org.did, collection: 'app.bsky.graph.verification', rkey })
    await db.delete(accountVerifications).where(and(eq(accountVerifications.verifierDid, p.org.did), eq(accountVerifications.subjectDid, p.subjectDid)))
    await audit(p.org.id, p.actorDid, 'revoke', p.subjectDid, 'revoked', uri)
    return { outcome: 'revoked' as const }
  } catch {
    await audit(p.org.id, p.actorDid, 'revoke', p.subjectDid, 'error')
    return { outcome: 'error' as const }
  }
}
