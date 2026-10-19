import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../src/lib/authz/session', () => ({ getActor: async () => ({ did: 'did:plc:actor' }) }))
vi.mock('../../src/lib/authz/membership', () => ({
  assertActiveMember: async () => {},
  AuthzError: class extends Error {
    status = 403
  },
}))

vi.mock('../../src/db/schema', () => ({
  accounts: { __t: 'accounts', did: 'did' } as any,
  backlogItems: { __t: 'backlogItems', subjectDid: 'subjectDid' } as any,
  accountVerifications: { __t: 'accountVerifications', subjectDid: 'subjectDid', verifierDid: 'verifierDid' } as any,
  orgs: { __t: 'orgs', id: 'id' } as any,
}))

// Mutable per-test fixtures, keyed by the table passed to `.from()`.
let orgRows: unknown[] = []
let verifiedRows: { subjectDid: string }[] = []
let indexedRows: { did: string }[] = []
let alreadyQueued = new Set<string>()
const insertedBacklog: Record<string, unknown>[] = []

vi.mock('../../src/db/client', () => ({
  db: {
    select: () => ({
      from: (table: any) => ({
        where: async () =>
          table.__t === 'orgs' ? orgRows : table.__t === 'accountVerifications' ? verifiedRows : indexedRows,
      }),
    }),
    insert: () => ({
      values: (vals: { subjectDid: string }[]) => ({
        onConflictDoNothing: () => ({
          returning: async () => {
            insertedBacklog.push(...vals)
            return vals.filter((v) => !alreadyQueued.has(v.subjectDid)).map((v) => ({ subjectDid: v.subjectDid }))
          },
        }),
      }),
    }),
  },
}))

const hydrate = vi.fn(async () => {})
vi.mock('../../src/crawler/hydrate', () => ({ hydrateAccounts: (...a: unknown[]) => hydrate(...(a as [])) }))
vi.mock('../../src/lib/atproto/publicAgent', () => ({ getPublicAppViewAgent: () => ({}) }))

import { POST } from '../../src/app/api/backlog/import/route'

const did = (c: string) => `did:plc:${c.repeat(24)}`

function req(body: unknown) {
  return new Request('http://x/vidi/api/backlog/import', { method: 'POST', body: JSON.stringify(body) }) as any
}

beforeEach(() => {
  orgRows = [{ id: 1, did: 'did:plc:org' }]
  verifiedRows = []
  indexedRows = []
  alreadyQueued = new Set()
  insertedBacklog.length = 0
  hydrate.mockClear()
  delete process.env.VIDI_IMPORT_MAX
})

describe('backlog import', () => {
  it('queues resolvable DIDs, skipping already-verified, unresolvable and invalid ones', async () => {
    verifiedRows = [{ subjectDid: did('a') }]
    indexedRows = [{ did: did('b') }, { did: did('c') }]
    alreadyQueued = new Set([did('c')])
    const res = await POST(req({ orgId: 1, dids: [did('a'), did('b'), did('b'), did('c'), did('d'), 'not-a-did'] }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ queued: 1, alreadyInBacklog: 1, alreadyVerified: 1, notFound: 1, invalid: 1 })
    // Already-verified subjects are never re-fetched from the network.
    expect(hydrate).toHaveBeenCalledWith(expect.anything(), [did('b'), did('c'), did('d')], 'import')
    expect(insertedBacklog.map((r) => r.subjectDid)).toEqual([did('b'), did('c')])
    expect(insertedBacklog[0]).toMatchObject({ orgId: 1, addedByDid: 'did:plc:actor', status: 'pending' })
  })

  it('rejects an empty list', async () => {
    expect((await POST(req({ orgId: 1, dids: [] }))).status).toBe(400)
  })

  it('rejects lists over the cap', async () => {
    process.env.VIDI_IMPORT_MAX = '2'
    const res = await POST(req({ orgId: 1, dids: [did('a'), did('b'), did('c')] }))
    expect(res.status).toBe(400)
    expect(hydrate).not.toHaveBeenCalled()
  })

  it('404s for an unknown org', async () => {
    orgRows = []
    expect((await POST(req({ orgId: 9, dids: [did('a')] }))).status).toBe(404)
  })
})
