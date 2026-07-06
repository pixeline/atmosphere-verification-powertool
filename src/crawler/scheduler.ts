import cron from 'node-cron'
import { runCrawl } from './run'

const expr = process.env.VIDI_CRAWL_CRON ?? '0 3 * * *'

cron.schedule(expr, () => {
  runCrawl().catch((e) => console.error('crawl failed', e))
})

console.log(`vidi crawler scheduled: ${expr}`)
