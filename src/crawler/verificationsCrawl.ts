import { AtpAgent } from '@atproto/api'
import { IdResolver } from '@atproto/identity'
import { db } from '../db/client'
import { accountVerifications } from '../db/schema'

export type VerificationEdge = { subjectDid: string; verifierDid: string; recordUri: string; createdAt?: string }

export function mapVerificationRecords(verifierDid: string, records: { uri: string; value: any }[]): VerificationEdge[] {
  return records.map((r) => ({
    subjectDid: r.value.subject,
    verifierDid,
    recordUri: r.uri,
    createdAt: r.value.createdAt,
  }))
}

/**
 * com.atproto.repo.listRecords can only be answered by the PDS that actually
 * hosts the given repo — a single fixed AppView agent 501s for any verifier
 * not hosted on that exact backend. Each verifier's own PDS is resolved via
 * its DID document (IdResolver) and queried directly. One verifier's
 * resolution/query failure is isolated so the rest of the crawl still runs.
 */
export async function crawlVerifications(verifierDids: string[]): Promise<VerificationEdge[]> {
  const idResolver = new IdResolver()
  const all: VerificationEdge[] = []
  for (const repo of verifierDids) {
    try {
      const { pds } = await idResolver.did.resolveAtprotoData(repo)
      const pdsAgent = new AtpAgent({ service: pds })
      let cursor: string | undefined
      do {
        const { data } = await pdsAgent.com.atproto.repo.listRecords({ repo, collection: 'app.bsky.graph.verification', limit: 100, cursor })
        const edges = mapVerificationRecords(repo, data.records as any)
        all.push(...edges)
        for (const e of edges) {
          await db.insert(accountVerifications)
            .values({ subjectDid: e.subjectDid, verifierDid: e.verifierDid, recordUri: e.recordUri, createdAt: e.createdAt ? new Date(e.createdAt) : undefined })
            .onConflictDoUpdate({ target: [accountVerifications.subjectDid, accountVerifications.verifierDid], set: { recordUri: e.recordUri } })
        }
        cursor = data.cursor
      } while (cursor)
    } catch (err) {
      console.error(`crawlVerifications: failed for verifier ${repo}`, err)
    }
  }
  return all
}
