import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../src/lib/authz/session', () => ({ getActor: async () => ({ did: 'did:plc:owner' }) }))
vi.mock('../../src/lib/authz/membership', () => ({
  assertOwner: async () => {},
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

// A guard: if the route ever imports runCrawl, this mock records that it was
// called — the test asserts it is NEVER called (the whole point of the change).
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
})
