import { describe, it, expect, vi } from 'vitest'
import { makeCrawlRunner } from '../../src/crawler/crawlRunner'

describe('makeCrawlRunner', () => {
  it('runs the crawl when idle and clears the running flag afterward', async () => {
    const runCrawl = vi.fn().mockResolvedValue(undefined)
    const { runCrawlGuarded } = makeCrawlRunner({ runCrawl, claimNextRequest: vi.fn() })
    await runCrawlGuarded()
    expect(runCrawl).toHaveBeenCalledTimes(1)
    // A second call after the first resolves runs again (flag was cleared).
    await runCrawlGuarded()
    expect(runCrawl).toHaveBeenCalledTimes(2)
  })

  it('skips a concurrent run while one is already in progress', async () => {
    let release: () => void = () => {}
    const runCrawl = vi.fn().mockImplementation(() => new Promise<void>((r) => { release = r }))
    const { runCrawlGuarded } = makeCrawlRunner({ runCrawl, claimNextRequest: vi.fn() })
    const first = runCrawlGuarded()   // starts, holds the flag
    await runCrawlGuarded()           // should be skipped (still running)
    expect(runCrawl).toHaveBeenCalledTimes(1)
    release()
    await first
  })

  it('clears the running flag even if the crawl throws', async () => {
    const runCrawl = vi.fn()
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce(undefined)
    const { runCrawlGuarded } = makeCrawlRunner({ runCrawl, claimNextRequest: vi.fn() })
    await runCrawlGuarded()           // throws internally, must not leak the flag
    await runCrawlGuarded()
    expect(runCrawl).toHaveBeenCalledTimes(2)
  })

  it('pollOnce runs the crawl when a request is claimed', async () => {
    const runCrawl = vi.fn().mockResolvedValue(undefined)
    const claimNextRequest = vi.fn().mockResolvedValue(true)
    const { pollOnce } = makeCrawlRunner({ runCrawl, claimNextRequest })
    await pollOnce()
    expect(claimNextRequest).toHaveBeenCalledTimes(1)
    expect(runCrawl).toHaveBeenCalledTimes(1)
  })

  it('pollOnce does nothing when no request is pending', async () => {
    const runCrawl = vi.fn().mockResolvedValue(undefined)
    const claimNextRequest = vi.fn().mockResolvedValue(false)
    const { pollOnce } = makeCrawlRunner({ runCrawl, claimNextRequest })
    await pollOnce()
    expect(runCrawl).not.toHaveBeenCalled()
  })
})
