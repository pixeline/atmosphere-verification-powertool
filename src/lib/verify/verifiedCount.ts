import { AtpAgent } from '@atproto/api'
import { IdResolver } from '@atproto/identity'

type CacheEntry = { count: number; at: number }

const cache = new Map<string, CacheEntry>()
const TTL_MS = 5 * 60 * 1000
const idResolver = new IdResolver()

/**
 * Live count of an org's own `app.bsky.graph.verification` records — the ground
 * truth for "accounts verified by this org", regardless of whether each record
 * was created via Vidi, Bluesky, or mu.social (all write the same record type
 * into the org's repo). This is authoritative and always current, unlike the
 * locally-crawled `account_verifications` table which only refreshes on a crawl
 * pass and so lags any verification made directly on the network.
 *
 * `com.atproto.repo.listRecords` can only be answered by the PDS that hosts the
 * repo, so we resolve the org's own PDS from its DID doc (mirroring
 * crawlVerifications). Counting paginates, so results are cached for TTL_MS to
 * keep the header-count endpoint cheap; call invalidateOrgVerificationCount
 * after an in-app verify to force an immediate recount.
 */
export async function countOrgVerifications(orgDid: string, now: number = Date.now()): Promise<number> {
  const hit = cache.get(orgDid)
  if (hit && now - hit.at < TTL_MS) return hit.count

  const { pds } = await idResolver.did.resolveAtprotoData(orgDid)
  const agent = new AtpAgent({ service: pds })
  let cursor: string | undefined
  let total = 0
  do {
    const { data } = await agent.com.atproto.repo.listRecords({
      repo: orgDid,
      collection: 'app.bsky.graph.verification',
      limit: 100,
      cursor,
    })
    total += data.records.length
    cursor = data.cursor
    if (!data.records.length) break
  } while (cursor)

  cache.set(orgDid, { count: total, at: now })
  return total
}

/** Drop the cached count so the next countOrgVerifications recomputes live. */
export function invalidateOrgVerificationCount(orgDid: string): void {
  cache.delete(orgDid)
}
