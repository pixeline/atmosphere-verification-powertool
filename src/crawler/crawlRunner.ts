/**
 * Pure crawl-run orchestration, decoupled from node-cron and the DB so it can
 * be unit-tested. `runCrawlGuarded` ensures the crawl never runs twice
 * concurrently in this process (cron and the manual-request poll share the
 * guard). `pollOnce` claims one pending request and, if it got one, runs.
 */
export function makeCrawlRunner(deps: {
  runCrawl: () => Promise<void>
  claimNextRequest: () => Promise<boolean>
}) {
  let running = false

  async function runCrawlGuarded(): Promise<void> {
    if (running) {
      console.log('crawlRunner: skipping — a crawl is already running')
      return
    }
    running = true
    try {
      await deps.runCrawl()
    } catch (err) {
      console.error('crawlRunner: crawl failed', err)
    } finally {
      running = false
    }
  }

  async function pollOnce(): Promise<void> {
    let claimed = false
    try {
      claimed = await deps.claimNextRequest()
    } catch (err) {
      console.error('crawlRunner: failed to claim a crawl request', err)
      return
    }
    if (claimed) await runCrawlGuarded()
  }

  return { runCrawlGuarded, pollOnce }
}
