import type { AtpAgent } from '@atproto/api'
import { eq } from 'drizzle-orm'
import { db } from '../db/client'
import { crawlSeeds } from '../db/schema'

export async function runKeywordSeed(agent: AtpAgent): Promise<string[]> {
  const seeds = await db.select().from(crawlSeeds).where(eq(crawlSeeds.enabled, true))
  const dids = new Set<string>()
  for (const s of seeds) {
    const { data } = await agent.searchActors({ q: s.keyword, limit: 100 })
    for (const a of data.actors) dids.add(a.did)
  }
  return [...dids]
}
