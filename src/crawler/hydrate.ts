import type { AtpAgent, AppBskyActorDefs } from '@atproto/api'
import { db } from '../db/client'
import { accounts } from '../db/schema'
import { isCustomDomain } from '../lib/domain/handleClassifier'

export function toAccountRow(p: AppBskyActorDefs.ProfileViewDetailed, seedSource: string) {
  return {
    did: p.did,
    handle: p.handle,
    displayName: p.displayName ?? null,
    description: p.description ?? null,
    avatar: p.avatar ?? null,
    isCustomDomain: isCustomDomain(p.handle),
    seedSource,
  }
}

export async function hydrateAccounts(agent: AtpAgent, dids: string[], seedSource = 'crawl'): Promise<void> {
  for (let i = 0; i < dids.length; i += 25) {
    const batch = dids.slice(i, i + 25)
    try {
      const { data } = await agent.getProfiles({ actors: batch })
      for (const p of data.profiles) {
        try {
          const row = toAccountRow(p, seedSource)
          await db.insert(accounts).values(row)
            .onConflictDoUpdate({
              target: accounts.did,
              set: {
                handle: row.handle,
                displayName: row.displayName,
                description: row.description,
                avatar: row.avatar,
                isCustomDomain: row.isCustomDomain,
              },
            })
        } catch (err) {
          console.error(`hydrateAccounts: failed to upsert account ${p.did}`, err)
        }
      }
    } catch (err) {
      console.error(`hydrateAccounts: failed to fetch profiles for batch starting at index ${i}`, err)
    }
  }
}
