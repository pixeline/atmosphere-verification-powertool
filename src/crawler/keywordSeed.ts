import { AtpAgent } from '@atproto/api'
import { eq } from 'drizzle-orm'
import { db } from '../db/client'
import { crawlSeeds } from '../db/schema'

const TYPEAHEAD_URL = () => process.env.VIDI_TYPEAHEAD_URL ?? 'https://typeahead.waow.tech'

/**
 * Discovers accounts from enabled crawl-seed keywords using a dedicated,
 * configurable typeahead search endpoint (VIDI_TYPEAHEAD_URL, defaulting to
 * https://typeahead.waow.tech) rather than the shared crawl AtpAgent's
 * `searchActors`. Typeahead is the appropriate query shape here: seed
 * keywords are short prefixes meant to surface candidate actors quickly,
 * which is what `app.bsky.actor.searchActorsTypeahead` is built for.
 *
 * The `agent` parameter is accepted (unused) to keep the function signature
 * and return type (`Promise<string[]>`) unchanged, since `src/crawler/run.ts`
 * calls this alongside the other crawl phases using the shared crawl agent.
 */
export async function runKeywordSeed(agent: AtpAgent): Promise<string[]> {
  void agent
  const typeaheadAgent = new AtpAgent({ service: TYPEAHEAD_URL() })
  const seeds = await db.select().from(crawlSeeds).where(eq(crawlSeeds.enabled, true))
  const dids = new Set<string>()
  for (const s of seeds) {
    try {
      const { data } = await typeaheadAgent.app.bsky.actor.searchActorsTypeahead({ q: s.keyword, limit: 100 })
      for (const a of data.actors) dids.add(a.did)
    } catch (err) {
      // A single malformed actor in the response (e.g. an invalid/unverified
      // handle) fails strict lexicon validation for the WHOLE query. Isolate
      // per-keyword so one bad result doesn't lose every other keyword's
      // discovery for this run.
      console.error(`runKeywordSeed: keyword "${s.keyword}" failed`, err)
    }
  }
  return [...dids]
}
