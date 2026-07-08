import { describe, it, expect, vi, beforeEach } from 'vitest'

const assertOwnerMock = vi.fn()
vi.mock('../../src/lib/authz/membership', () => ({
  assertOwner: assertOwnerMock,
  AuthzError: class extends Error {
    status = 403
  },
}))

let runCrawlResolve: (() => void) | null = null
const runCrawlMock = vi.fn(
  () =>
    new Promise<void>((resolve) => {
      runCrawlResolve = resolve
    })
)
vi.mock('../../src/crawler/run', () => ({ runCrawl: runCrawlMock }))

describe('crawl/run route', () => {
  beforeEach(() => {
    vi.resetModules()
    assertOwnerMock.mockReset()
    runCrawlMock.mockClear()
    runCrawlResolve = null
  })

  it('401 when not logged in', async () => {
    vi.doMock('../../src/lib/authz/session', () => ({ getActor: async () => null }))
    const { POST } = await import('../../src/app/api/crawl/run/route')
    const req = new Request('http://x/vidi/api/crawl/run', { method: 'POST', body: JSON.stringify({ orgId: 1 }) })
    expect((await POST(req as any)).status).toBe(401)
  })

  it('403 when not owner', async () => {
    vi.doMock('../../src/lib/authz/session', () => ({ getActor: async () => ({ did: 'did:plc:helper' }) }))
    assertOwnerMock.mockImplementation(async () => {
      const { AuthzError } = await import('../../src/lib/authz/membership')
      throw new AuthzError('owner required')
    })
    const { POST } = await import('../../src/app/api/crawl/run/route')
    const req = new Request('http://x/vidi/api/crawl/run', { method: 'POST', body: JSON.stringify({ orgId: 1 }) })
    expect((await POST(req as any)).status).toBe(403)
  })

  it('responds immediately without awaiting runCrawl to finish', async () => {
    vi.doMock('../../src/lib/authz/session', () => ({ getActor: async () => ({ did: 'did:plc:owner' }) }))
    assertOwnerMock.mockResolvedValue(undefined)
    const { POST } = await import('../../src/app/api/crawl/run/route')
    const req = new Request('http://x/vidi/api/crawl/run', { method: 'POST', body: JSON.stringify({ orgId: 1 }) })
    const res = await POST(req as any)
    const body = await res.json()
    expect(body).toEqual({ ok: true, started: true })
    expect(runCrawlMock).toHaveBeenCalledTimes(1)
    // The route already resolved even though runCrawl's own promise has not:
    expect(runCrawlResolve).not.toBeNull()
  })
})
