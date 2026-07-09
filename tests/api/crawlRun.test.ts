import { describe, it, expect, vi, beforeEach } from 'vitest'

const getActorMock = vi.fn(async (): Promise<{ did: string } | null> => ({ did: 'did:plc:owner' }))
vi.mock('../../src/lib/authz/session', () => ({ getActor: () => getActorMock() }))

const assertOwnerMock = vi.fn(async (..._args: unknown[]) => {})
vi.mock('../../src/lib/authz/membership', () => ({
  assertOwner: (...args: unknown[]) => assertOwnerMock(...args),
  AuthzError: class extends Error {
    status = 403
  },
}))

vi.mock('../../src/db/schema', () => ({
  crawlRequests: { __t: 'crawlRequests' } as any,
}))

const insertedInto: string[] = []
const insertedValues: Record<string, unknown>[] = []
vi.mock('../../src/db/client', () => ({
  db: {
    insert: (table: any) => {
      insertedInto.push(table?.__t)
      return {
        values: async (values: Record<string, unknown>) => {
          insertedValues.push(values)
        },
      }
    },
  },
}))

const runCrawl = vi.fn()
vi.mock('../../src/crawler/run', () => ({ runCrawl: () => runCrawl() }))

import { POST } from '../../src/app/api/crawl/run/route'

function makeReq(body: unknown) {
  return { json: async () => body } as any
}

beforeEach(() => {
  insertedInto.length = 0
  insertedValues.length = 0
  runCrawl.mockReset()
  getActorMock.mockReset()
  getActorMock.mockResolvedValue({ did: 'did:plc:owner' })
  assertOwnerMock.mockReset()
  assertOwnerMock.mockResolvedValue(undefined)
})

describe('POST /api/crawl/run', () => {
  it('enqueues a crawl_requests row and does not run the crawl in-process', async () => {
    const res = await POST(makeReq({ orgId: 1 }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toMatchObject({ ok: true, queued: true })
    expect(insertedInto).toEqual(['crawlRequests'])
    expect(insertedValues[0]).toMatchObject({ requestedByDid: 'did:plc:owner' })
    expect(runCrawl).not.toHaveBeenCalled()
  })

  it('401 when not logged in', async () => {
    getActorMock.mockResolvedValueOnce(null)
    const res = await POST(makeReq({ orgId: 1 }))
    expect(res.status).toBe(401)
    expect(insertedInto).toEqual([])
  })

  it('403 when not owner', async () => {
    const { AuthzError } = await import('../../src/lib/authz/membership')
    assertOwnerMock.mockRejectedValueOnce(new AuthzError('owner required'))
    const res = await POST(makeReq({ orgId: 1 }))
    expect(res.status).toBe(403)
    expect(insertedInto).toEqual([])
  })
})
