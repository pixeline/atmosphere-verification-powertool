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
 *
 * Deliberate deviation from the original design spec: we read
 * `post.indexedAt` (server-assigned, when the AppView indexed the post)
 * rather than `post.record.createdAt` (client-set, part of the signed
 * record). indexedAt can't be backdated or spoofed by the account owner,
 * so it's a more trustworthy "last active" signal than a self-reported
 * timestamp.
 *
 * Known, accepted caveat (shared by the spec's original createdAt approach
 * too — not a new bug introduced by this change): if the most recent feed
 * item is a repost, `post.indexedAt` reflects when the ORIGINAL post was
 * indexed, not when the repost happened. The true repost time would live
 * at `feed[0].reason.indexedAt` when `feed[0].reason` is a repost. This
 * means an account whose latest activity is reposting something old can
 * be understated as less active than it really is. This is intentional
 * and not something to "fix" here.
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
