import type { AtpAgent } from '@atproto/api'
import { eq, isNull, lt, or } from 'drizzle-orm'
import { db } from '../db/client'
import { accounts } from '../db/schema'

const STALE_AFTER_MS = 7 * 24 * 60 * 60 * 1000

/**
 * Refreshes accounts.lastActiveAt from each account's most recent post.
 * getAuthorFeed has no multi-actor batch form (unlike getProfiles), so this
 * is bounded to accounts whose last_active_checked_at is null or more than
 * 7 days old — re-checking everyone on every crawl would multiply network
 * calls by the account count and risk the public AppView's rate limits.
 */
export async function refreshLastActive(agent: AtpAgent): Promise<void> {
  const staleCutoff = new Date(Date.now() - STALE_AFTER_MS)
  const stale = await db
    .select({ did: accounts.did })
    .from(accounts)
    .where(or(isNull(accounts.lastActiveCheckedAt), lt(accounts.lastActiveCheckedAt, staleCutoff)))

  for (const { did } of stale) {
    try {
      const { data } = await agent.app.bsky.feed.getAuthorFeed({ actor: did, limit: 1 })
      const lastPostIndexedAt = data.feed[0]?.post.indexedAt
      await db
        .update(accounts)
        .set({
          lastActiveAt: lastPostIndexedAt ? new Date(lastPostIndexedAt) : null,
          lastActiveCheckedAt: new Date(),
        })
        .where(eq(accounts.did, did))
    } catch (err) {
      console.error(`refreshLastActive: failed for ${did}`, err)
    }
  }
}
