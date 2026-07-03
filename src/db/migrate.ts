import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { db, pool } from './client'

export async function runMigrations() {
  await migrate(db, { migrationsFolder: './drizzle' })
}

// ESM-safe CLI entrypoint check. This project has no "type": "module" in
// package.json, but is run via `npx tsx src/db/migrate.ts` (an ESM-capable
// loader) — `require.main === module` is unreliable here, so compare
// import.meta.url against the invoked script path instead.
const isMain = (() => {
  try {
    return import.meta.url === `file://${process.argv[1]}`
  } catch {
    return false
  }
})()

if (isMain) {
  runMigrations()
    .then(() => pool.end())
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(err)
      process.exit(1)
    })
}
