import type { AtpAgent } from '@atproto/api'
import { db } from '../db/client'
import { trustedVerifiers } from '../db/schema'

export async function resolveTrustedVerifierDids(agent: AtpAgent, uris: string[]): Promise<string[]> {
  const dids = new Set<string>()
  for (const list of uris) {
    let cursor: string | undefined
    do {
      const { data } = await agent.app.bsky.graph.getList({ list, limit: 100, cursor })
      for (const item of data.items) dids.add(item.subject.did)
      cursor = data.cursor
    } while (cursor)
  }
  return [...dids]
}

export async function syncTrustedVerifiers(agent: AtpAgent): Promise<string[]> {
  const uris = (process.env.TRUSTED_VERIFIER_LIST_URIS ?? '').split(/[\s,]+/).filter(Boolean)
  const dids = await resolveTrustedVerifierDids(agent, uris)
  for (const did of dids) {
    await db.insert(trustedVerifiers).values({ did, sourceListUri: uris[0] })
      .onConflictDoNothing()
  }
  return dids
}
