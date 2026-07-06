import { db } from '../src/db/client'
import { crawlSeeds } from '../src/db/schema'
import { addToAllowlist } from '../src/lib/allowlist'
import { validateEnv } from '../src/lib/env'
import { isMain } from '../src/lib/isMain'

export function parseSeeds(s: string): string[] {
  return s.split(',').map((x) => x.trim()).filter(Boolean)
}

export async function seed() {
  for (const did of parseSeeds(process.env.VIDI_SEED_ALLOWLIST ?? '')) {
    await addToAllowlist(did, '', 'seed')
  }
  for (const kw of parseSeeds(process.env.VIDI_SEED_KEYWORDS ?? '')) {
    await db.insert(crawlSeeds).values({ keyword: kw, enabled: true }).onConflictDoNothing()
  }
}

// ESM-safe CLI entrypoint check. Mirror of src/db/migrate.ts pattern.
if (isMain(import.meta.url)) {
  validateEnv()
  seed()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(err)
      process.exit(1)
    })
}
