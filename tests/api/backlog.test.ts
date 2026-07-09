import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('../../src/lib/authz/session', () => ({ getActor: async () => ({ did: 'did:plc:a' }) }))
vi.mock('../../src/lib/authz/membership', () => ({
  assertActiveMember: async () => {},
  AuthzError: class extends Error {
    status = 403
  },
}))

const publicGetProfile = vi.fn()
vi.mock('@atproto/api', () => ({
  AtpAgent: class {
    constructor() {
      return { getProfile: publicGetProfile } as any
    }
  },
}))

// Distinguish each table's select by a sentinel field on the mocked table
// object passed to `.from()` — same pattern already used in
// tests/app/orgContext.test.ts and tests/api/search.test.ts.
vi.mock('../../src/db/schema', () => ({
  accounts: { __t: 'accounts' } as any,
  backlogItems: { __t: 'backlogItems' } as any,
  accountVerifications: { __t: 'accountVerifications' } as any,
  trustedVerifiers: { __t: 'trustedVerifiers' } as any,
  orgs: { __t: 'orgs' } as any,
}))

const insertedValues: Record<string, unknown>[] = []
let selectResult: unknown[] = []       // POST's "is this subject already indexed" check
let backlogRows: unknown[] = []        // GET's main enriched query (backlogItems LEFT JOIN accounts)
let verifierRows: unknown[] = []       // GET's verifier enrichment query
let verifierQueryCallCount = 0         // Track calls to accountVerifications branch

vi.mock('../../src/db/client', () => ({
  db: {
    select: () => ({
      from: (table: any) => {
        if (table?.__t === 'backlogItems') {
          return { leftJoin: () => ({ where: async () => backlogRows }) }
        }
        if (table?.__t === 'accountVerifications') {
          verifierQueryCallCount++
          return { leftJoin: () => ({ leftJoin: () => ({ where: async () => verifierRows }) }) }
        }
        return { where: async () => selectResult } // accounts
      },
    }),
    insert: () => ({
      values: (values: Record<string, unknown>) => {
        insertedValues.push(values)
        return { onConflictDoUpdate: async () => {} }
      },
    }),
  },
}))

import { GET, POST } from '../../src/app/api/backlog/route'

beforeEach(() => {
  insertedValues.length = 0
  selectResult = []
  backlogRows = []
  verifierRows = []
  verifierQueryCallCount = 0
  publicGetProfile.mockReset()
})

describe('backlog route account upsert', () => {
  it('upserts an accounts row (server-resolved identity) when handle hints a live-only, not-yet-indexed result', async () => {
    publicGetProfile.mockResolvedValue({
      data: { handle: 'newfound.brussels', displayName: 'New', description: 'bio', avatar: null },
    })
    const req = new Request('http://x/vidi/api/backlog', {
      method: 'POST',
      body: JSON.stringify({ orgId: 1, subjectDid: 'did:plc:live', handle: 'newfound.brussels' }),
    })
    await POST(req as any)
    expect(publicGetProfile).toHaveBeenCalledWith({ actor: 'did:plc:live' })
    const accountsInsert = insertedValues.find((v) => 'handle' in v)
    expect(accountsInsert).toBeTruthy()
    expect(accountsInsert!.handle).toBe('newfound.brussels')
    const backlogInsert = insertedValues.find((v) => 'subjectDid' in v && 'status' in v)
    expect(backlogInsert).toBeTruthy()
  })

  it('copies followersCount/followsCount from the resolved profile into the upserted accounts row', async () => {
    publicGetProfile.mockResolvedValue({
      data: { handle: 'newfound.brussels', displayName: 'New', description: null, avatar: null, followersCount: 8, followsCount: 20 },
    })
    const req = new Request('http://x/vidi/api/backlog', {
      method: 'POST',
      body: JSON.stringify({ orgId: 1, subjectDid: 'did:plc:live2', handle: 'newfound.brussels' }),
    })
    await POST(req as any)
    const accountsInsert = insertedValues.find((v) => 'handle' in v)
    expect(accountsInsert).toBeTruthy()
    expect(accountsInsert!.followersCount).toBe(8)
    expect(accountsInsert!.followsCount).toBe(20)
  })

  it('does not touch accounts when handle is absent (already-indexed result)', async () => {
    const req = new Request('http://x/vidi/api/backlog', {
      method: 'POST',
      body: JSON.stringify({ orgId: 1, subjectDid: 'did:plc:indexed' }),
    })
    await POST(req as any)
    expect(publicGetProfile).not.toHaveBeenCalled()
    const accountsInsert = insertedValues.find((v) => 'handle' in v)
    expect(accountsInsert).toBeUndefined()
    const backlogInsert = insertedValues.find((v) => 'subjectDid' in v && 'status' in v)
    expect(backlogInsert).toBeTruthy()
  })

  it('does not touch accounts when the subject is already indexed, even if handle is provided', async () => {
    selectResult = [{ did: 'did:plc:already', handle: 'existing.example' }]
    const req = new Request('http://x/vidi/api/backlog', {
      method: 'POST',
      body: JSON.stringify({ orgId: 1, subjectDid: 'did:plc:already', handle: 'whatever.example' }),
    })
    await POST(req as any)
    expect(publicGetProfile).not.toHaveBeenCalled()
    const accountsInsert = insertedValues.find((v) => 'handle' in v)
    expect(accountsInsert).toBeUndefined()
  })

  it('ignores a client-supplied handle and stores the server-resolved handle instead (spoofing regression)', async () => {
    publicGetProfile.mockResolvedValue({
      data: { handle: 'real-owner.example', displayName: 'Real Owner', description: null, avatar: null },
    })
    const req = new Request('http://x/vidi/api/backlog', {
      method: 'POST',
      body: JSON.stringify({ orgId: 1, subjectDid: 'did:plc:victim', handle: 'attacker-controlled.example' }),
    })
    await POST(req as any)
    const accountsInsert = insertedValues.find((v) => 'handle' in v)
    expect(accountsInsert).toBeTruthy()
    expect(accountsInsert!.handle).toBe('real-owner.example')
    expect(accountsInsert!.handle).not.toBe('attacker-controlled.example')
  })
})

describe('backlog route GET enrichment', () => {
  it('returns profile fields and verifiers alongside subjectDid/note', async () => {
    backlogRows = [
      {
        subjectDid: 'did:plc:queued',
        note: 'check this one',
        handle: 'queued.example',
        displayName: 'Queued Account',
        description: 'a bio',
        isCustomDomain: true,
        followersCount: 10,
        followsCount: 5,
        lastActiveAt: '2026-01-01T00:00:00.000Z',
      },
    ]
    verifierRows = [
      { subjectDid: 'did:plc:queued', verifierDid: 'did:plc:tv1', tvHandle: 'tv.example', orgHandle: null },
    ]
    const req = new NextRequest('http://x/vidi/api/backlog?orgId=1')
    const res = await GET(req as any)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.items).toHaveLength(1)
    expect(body.items[0]).toMatchObject({
      subjectDid: 'did:plc:queued',
      note: 'check this one',
      handle: 'queued.example',
      displayName: 'Queued Account',
      description: 'a bio',
      isCustomDomain: true,
      followersCount: 10,
      followsCount: 5,
      lastActiveAt: '2026-01-01T00:00:00.000Z',
      verifiers: [{ did: 'did:plc:tv1', handle: 'tv.example' }],
    })
  })

  it('returns an empty verifiers array for a queued account with no verification row', async () => {
    backlogRows = [{ subjectDid: 'did:plc:unverified', note: null, handle: 'x.example', displayName: null, description: null, isCustomDomain: false, followersCount: null, followsCount: null, lastActiveAt: null }]
    verifierRows = []
    const req = new NextRequest('http://x/vidi/api/backlog?orgId=1')
    const res = await GET(req as any)
    const body = await res.json()
    expect(body.items[0].verifiers).toEqual([])
  })

  it('returns an empty items array without querying verifiers when the backlog is empty', async () => {
    backlogRows = []
    const req = new NextRequest('http://x/vidi/api/backlog?orgId=1')
    const res = await GET(req as any)
    const body = await res.json()
    expect(body.items).toEqual([])
    expect(verifierQueryCallCount).toBe(0)
  })
})
