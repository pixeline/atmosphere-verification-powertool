import { AtpAgent } from '@atproto/api'
import { eq } from 'drizzle-orm'
import { db } from '../db/client'
import { crawlRuns, orgs } from '../db/schema'
import { syncTrustedVerifiers } from './trustedVerifiers'
import { crawlVerifications, type VerificationEdge } from './verificationsCrawl'
import { runKeywordSeed } from './keywordSeed'
import { hydrateAccounts } from './hydrate'
import { refreshLastActive } from './refreshLastActive'
import { validateEnv } from '../lib/env'
import { isMain } from '../lib/isMain'

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

  // An onboarded org IS a trusted verifier by definition (that's the entire
  // premise of the allowlist gate) — always crawl its own verification
  // records too, independent of whether it also happens to be on Mu's
  // external TRUSTED_VERIFIER_LIST_URIS list.
  try {
    const ownOrgs = await db.select({ did: orgs.did }).from(orgs)
    verifierDids = [...new Set([...verifierDids, ...ownOrgs.map((o) => o.did)])]
  } catch (err) {
    console.error('runCrawl: failed to load org DIDs for self-verification crawl', err)
  }

  let edges: VerificationEdge[] = []
  try {
    edges = await crawlVerifications(verifierDids)
  } catch (err) {
    console.error('runCrawl: crawlVerifications failed', err)
  }
  const verifiedSubjects = [...new Set(edges.map((e) => e.subjectDid))]

  let keywordDids: string[] = []
  try {
    keywordDids = await runKeywordSeed(agent)
  } catch (err) {
    console.error('runCrawl: runKeywordSeed failed', err)
  }

  const allDids = [...new Set([...verifiedSubjects, ...keywordDids])]
  try {
    await hydrateAccounts(agent, allDids)
  } catch (err) {
    console.error('runCrawl: hydrateAccounts failed', err)
  }

  try {
    await refreshLastActive(agent)
  } catch (err) {
    console.error('runCrawl: refreshLastActive failed', err)
  }

  await db.update(crawlRuns)
    .set({
      finishedAt: new Date(),
      stats: { verifiers: verifierDids.length, edges: edges.length, discovered: allDids.length },
    })
    .where(eq(crawlRuns.id, run.id))
}

// ESM-safe CLI entry: check if this module is the entry point (realpath-based
// so a symlinked deploy path doesn't defeat the comparison).
if (isMain(import.meta.url)) {
  validateEnv()
  runCrawl()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('Crawler failed:', err)
      process.exit(1)
    })
}
