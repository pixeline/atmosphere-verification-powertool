import type { AtpAgent } from '@atproto/api'
import { db } from '../db/client'
import { trustedVerifiers } from '../db/schema'

export type TrustedVerifierEntry = { did: string; handle: string }

export async function resolveTrustedVerifierDids(agent: AtpAgent, uris: string[]): Promise<TrustedVerifierEntry[]> {
  const byDid = new Map<string, string>()
  for (const list of uris) {
    let cursor: string | undefined
    do {
      const { data } = await agent.app.bsky.graph.getList({ list, limit: 100, cursor })
      for (const item of data.items) byDid.set(item.subject.did, item.subject.handle)
      cursor = data.cursor
    } while (cursor)
  }
  return [...byDid].map(([did, handle]) => ({ did, handle }))
}

export async function syncTrustedVerifiers(agent: AtpAgent): Promise<string[]> {
  const uris = (process.env.TRUSTED_VERIFIER_LIST_URIS ?? '').split(/[\s,]+/).filter(Boolean)
  const entries = await resolveTrustedVerifierDids(agent, uris)
  for (const entry of entries) {
    await db.insert(trustedVerifiers).values({ did: entry.did, handle: entry.handle, sourceListUri: uris[0] })
      .onConflictDoUpdate({ target: trustedVerifiers.did, set: { handle: entry.handle } })
  }
  return entries.map((e) => e.did)
}
