import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../src/lib/authz/membership', () => ({
  assertOwner: (...args: unknown[]) => assertOwnerMock(...args),
  AuthzError: class extends Error {
    status = 403
  },
}))
const assertOwnerMock = vi.fn()

let seedRows: unknown[] = []
const insertCalls: Array<{ values: unknown; conflict: unknown }> = []
const updateCalls: Array<{ set: unknown; where: unknown }> = []

vi.mock('../../src/db/client', () => ({
  db: {
    select: () => ({ from: () => seedRows }),
    insert: () => ({
      values: (values: unknown) => ({
        onConflictDoUpdate: (conflict: unknown) => {
          insertCalls.push({ values, conflict })
          return Promise.resolve()
        },
      }),
    }),
    update: () => ({
      set: (set: unknown) => ({
        where: (where: unknown) => {
          updateCalls.push({ set, where })
          return Promise.resolve()
        },
      }),
    }),
  },
}))

describe('crawl-seeds route', () => {
  beforeEach(() => {
    vi.resetModules()
    seedRows = [{ id: 1, keyword: 'brussels', enabled: true }]
    insertCalls.length = 0
    updateCalls.length = 0
    assertOwnerMock.mockReset()
  })

  it('401 when not logged in (GET)', async () => {
    vi.doMock('../../src/lib/authz/session', () => ({ getActor: async () => null }))
    const { GET } = await import('../../src/app/api/crawl-seeds/route')
    const req = new Request('http://x/vidi/api/crawl-seeds?orgId=1')
    expect((await GET(req as any)).status).toBe(401)
  })

  it('403 when not owner (GET)', async () => {
    vi.doMock('../../src/lib/authz/session', () => ({ getActor: async () => ({ did: 'did:plc:helper' }) }))
    assertOwnerMock.mockImplementation(async () => {
      const { AuthzError } = await import('../../src/lib/authz/membership')
      throw new AuthzError('owner required')
    })
    const { GET } = await import('../../src/app/api/crawl-seeds/route')
    const req = new Request('http://x/vidi/api/crawl-seeds?orgId=1')
    expect((await GET(req as any)).status).toBe(403)
  })

  it('lists seeds for an owner', async () => {
    vi.doMock('../../src/lib/authz/session', () => ({ getActor: async () => ({ did: 'did:plc:owner' }) }))
    assertOwnerMock.mockResolvedValue(undefined)
    const { GET } = await import('../../src/app/api/crawl-seeds/route')
    const req = new Request('http://x/vidi/api/crawl-seeds?orgId=1')
    const res = await GET(req as any)
    const body = await res.json()
    expect(body.seeds).toEqual(seedRows)
  })

  it('POST upserts a keyword, re-enabling if it already exists', async () => {
    vi.doMock('../../src/lib/authz/session', () => ({ getActor: async () => ({ did: 'did:plc:owner' }) }))
    assertOwnerMock.mockResolvedValue(undefined)
    const { POST } = await import('../../src/app/api/crawl-seeds/route')
    const req = new Request('http://x/vidi/api/crawl-seeds', {
      method: 'POST',
      body: JSON.stringify({ orgId: 1, keyword: 'namur' }),
    })
    const res = await POST(req as any)
    expect(res.status).toBe(200)
    expect(insertCalls[0].values).toEqual({ keyword: 'namur', enabled: true })
  })

  it('PATCH toggles enabled state', async () => {
    vi.doMock('../../src/lib/authz/session', () => ({ getActor: async () => ({ did: 'did:plc:owner' }) }))
    assertOwnerMock.mockResolvedValue(undefined)
    const { PATCH } = await import('../../src/app/api/crawl-seeds/route')
    const req = new Request('http://x/vidi/api/crawl-seeds', {
      method: 'PATCH',
      body: JSON.stringify({ orgId: 1, keyword: 'namur', enabled: false }),
    })
    const res = await PATCH(req as any)
    expect(res.status).toBe(200)
    expect(updateCalls[0].set).toEqual({ enabled: false })
  })
})
