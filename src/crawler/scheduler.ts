import cron from 'node-cron'
import { asc, eq, isNull } from 'drizzle-orm'
import { db } from '../db/client'
import { crawlRequests } from '../db/schema'
import { runCrawl } from './run'
import { makeCrawlRunner } from './crawlRunner'

const expr = process.env.VIDI_CRAWL_CRON ?? '0 3 * * *'
const pollMs = Number(process.env.VIDI_CRAWL_POLL_MS ?? 30_000)

/**
 * Claims the oldest unclaimed crawl request by stamping claimed_at. Returns
 * true if one was claimed. Claiming before the run means a request is consumed
 * even if the subsequent run errors — a failed run must not re-trigger forever.
 * A single worker container runs this, so the non-atomic select-then-update is
 * safe; the claimed_at column additionally makes consumption durable.
 */
async function claimNextRequest(): Promise<boolean> {
  const [pending] = await db
    .select({ id: crawlRequests.id })
    .from(crawlRequests)
    .where(isNull(crawlRequests.claimedAt))
    .orderBy(asc(crawlRequests.id))
    .limit(1)
  if (!pending) return false
  await db.update(crawlRequests).set({ claimedAt: new Date() }).where(eq(crawlRequests.id, pending.id))
  return true
}

const { runCrawlGuarded, pollOnce } = makeCrawlRunner({ runCrawl, claimNextRequest })

cron.schedule(expr, () => { void runCrawlGuarded() })
setInterval(() => { void pollOnce() }, pollMs)

console.log(`vidi crawler scheduled: ${expr}; polling crawl_requests every ${pollMs}ms`)
