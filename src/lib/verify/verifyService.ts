import { AtpAgent } from '@atproto/api'
import { and, eq } from 'drizzle-orm'
import { db } from '../../db/client'
import { accountVerifications, accounts, verificationActions } from '../../db/schema'
import { getOrgAgent } from '../atproto/orgAgent'
import { checkGuards } from './guardrails'

type Org = { id: number; did: string }

/**
 * Unauthenticated public AppView agent for app.bsky.* reads.
 *
 * Per the atproto read-vs-write architecture, routing app.bsky.* reads
 * through the OAuth-bound org agent proxies the call through the org's PDS,
 * which for non-bsky.social PDS deployments (e.g. eurosky.social) does not
 * reliably implement the PDS-as-AppView-proxy contract and returns
 * `401 Unauthorized` even though OAuth itself succeeded. The public AppView
 * needs no scope/DPoP and works for any account regardless of which PDS
 * hosts it, so we use it for the getProfile fallback below instead.
 */
function getPublicAppViewAgent(): AtpAgent {
  return new AtpAgent({ service: process.env.VIDI_PUBLIC_APPVIEW_URL ?? 'https://public.api.bsky.app' })
}

async function audit(orgId: number, actorDid: string, action: 'verify' | 'revoke', subjectDid: string, outcome: string, recordUri?: string) {
  await db.insert(verificationActions).values({ orgId, actorDid, action, subjectDid, outcome, recordUri })
}

/**
 * Resolves the authoritative handle/displayName for a subject DID.
 *
 * The client-supplied handle/displayName in the request body is NOT trusted
 * here — a malicious or buggy client could send a subject.did paired with an
 * arbitrary handle, which would then get burned into an on-chain
 * verification record and our local index. Instead we resolve identity
 * server-side: first from our own indexed `accounts` table (populated by the
 * crawler/hydrate pipeline), falling back to a live lookup via the
 * unauthenticated public AppView's `getProfile` for subjects we haven't
 * indexed yet.
 *
 * The fallback deliberately does NOT use the org's OAuth-bound agent: that
 * routes app.bsky.* reads through the org's own PDS, which 401s on
 * non-bsky.social PDS deployments (see getPublicAppViewAgent above).
 */
async function resolveSubjectIdentity(did: string): Promise<{ handle: string; displayName?: string }> {
  const rows = await db.select().from(accounts).where(eq(accounts.did, did))
  if (rows[0]) {
    return { handle: rows[0].handle, displayName: rows[0].displayName ?? undefined }
  }
  const prof = await getPublicAppViewAgent().getProfile({ actor: did })
  return { handle: prof.data.handle, displayName: prof.data.displayName }
}

export async function verifyOne(p: { org: Org; actorDid: string; subject: { did: string } }) {
  const guard = await checkGuards(p.org.did, p.subject.did)
  if (!guard.ok) {
    const outcome = guard.reason === 'denylist' ? ('skipped-denylist' as const) : ('skipped-duplicate' as const)
    await audit(p.org.id, p.actorDid, 'verify', p.subject.did, outcome)
    return { outcome }
  }
  try {
    const agent = await getOrgAgent(p.org.did)
    const identity = await resolveSubjectIdentity(p.subject.did)
    const createdAt = new Date().toISOString()
    const { data } = await agent.com.atproto.repo.createRecord({
      repo: p.org.did,
      collection: 'app.bsky.graph.verification',
      record: { subject: p.subject.did, handle: identity.handle, displayName: identity.displayName ?? '', createdAt },
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
    if (!rows[0]) {
      await audit(p.org.id, p.actorDid, 'revoke', p.subjectDid, 'error')
      return { outcome: 'error' as const }
    }
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
