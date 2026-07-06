import type { AtpAgent } from '@atproto/api'
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

export async function crawlVerifications(agent: AtpAgent, verifierDids: string[]): Promise<VerificationEdge[]> {
  const all: VerificationEdge[] = []
  for (const repo of verifierDids) {
    let cursor: string | undefined
    do {
      const { data } = await agent.com.atproto.repo.listRecords({ repo, collection: 'app.bsky.graph.verification', limit: 100, cursor })
      const edges = mapVerificationRecords(repo, data.records as any)
      all.push(...edges)
      for (const e of edges) {
        await db.insert(accountVerifications)
          .values({ subjectDid: e.subjectDid, verifierDid: e.verifierDid, recordUri: e.recordUri, createdAt: e.createdAt ? new Date(e.createdAt) : undefined })
          .onConflictDoUpdate({ target: [accountVerifications.subjectDid, accountVerifications.verifierDid], set: { recordUri: e.recordUri } })
      }
      cursor = data.cursor
    } while (cursor)
  }
  return all
}
