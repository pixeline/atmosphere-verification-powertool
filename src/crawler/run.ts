import { AtpAgent } from '@atproto/api'
import { eq } from 'drizzle-orm'
import { db } from '../db/client'
import { accountSignals, crawlRuns } from '../db/schema'
import { syncTrustedVerifiers } from './trustedVerifiers'
import { crawlVerifications, type VerificationEdge } from './verificationsCrawl'
import { collectFollowedByVerified } from './followsCrawl'
import { runKeywordSeed } from './keywordSeed'
import { hydrateAccounts } from './hydrate'

/**
 * Runs one full crawl pass. Each phase is isolated in its own try/catch so a
 * single failing source (e.g. one verifier's follows, or the keyword search)
 * does not abort the whole run — we keep whatever data we gathered so far and
 * still record a finished `crawlRuns` row with stats reflecting partial progress.
 */
export async function runCrawl(service = process.env.MU_APPVIEW_URL ?? 'https://mu.social'): Promise<void> {
  const agent = new AtpAgent({ service })
  const [run] = await db.insert(crawlRuns).values({}).returning()

  let verifierDids: string[] = []
  try {
    verifierDids = await syncTrustedVerifiers(agent)
  } catch (err) {
    console.error('runCrawl: syncTrustedVerifiers failed', err)
  }

  let edges: VerificationEdge[] = []
  try {
    edges = await crawlVerifications(agent, verifierDids)
  } catch (err) {
    console.error('runCrawl: crawlVerifications failed', err)
  }
  const verifiedSubjects = [...new Set(edges.map((e) => e.subjectDid))]
  const seedDids = [...new Set([...verifierDids, ...verifiedSubjects])]

  const followedMap = new Map<string, string[]>()
  for (const seedDid of seedDids) {
    try {
      const partial = await collectFollowedByVerified(agent, [seedDid])
      for (const [did, followers] of partial) {
        const arr = followedMap.get(did) ?? []
        for (const f of followers) if (!arr.includes(f)) arr.push(f)
        followedMap.set(did, arr)
      }
    } catch (err) {
      console.error(`runCrawl: collectFollowedByVerified failed for ${seedDid}`, err)
    }
  }

  let keywordDids: string[] = []
  try {
    keywordDids = await runKeywordSeed(agent)
  } catch (err) {
    console.error('runCrawl: runKeywordSeed failed', err)
  }

  const allDids = [...new Set([...verifiedSubjects, ...followedMap.keys(), ...keywordDids])]
  try {
    await hydrateAccounts(agent, allDids)
  } catch (err) {
    console.error('runCrawl: hydrateAccounts failed', err)
  }

  for (const [did, verifiedFollowers] of followedMap) {
    try {
      await db.insert(accountSignals).values({ subjectDid: did, followedByVerified: true, verifiedFollowers })
        .onConflictDoUpdate({ target: accountSignals.subjectDid, set: { followedByVerified: true, verifiedFollowers } })
    } catch (err) {
      console.error(`runCrawl: failed to write accountSignals for ${did}`, err)
    }
  }

  await db.update(crawlRuns)
    .set({
      finishedAt: new Date(),
      stats: { verifiers: verifierDids.length, edges: edges.length, discovered: allDids.length },
    })
    .where(eq(crawlRuns.id, run.id))
}

// ESM-safe CLI entry: check if this module is the entry point
if (import.meta.url === `file://${process.argv[1]}`) {
  runCrawl()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('Crawler failed:', err)
      process.exit(1)
    })
}
