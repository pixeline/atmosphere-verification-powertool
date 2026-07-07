import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../src/lib/authz/membership', () => ({
  assertActiveMember: async () => {},
  AuthzError: class extends Error {
    status = 403
  },
}))

const searchResults = [
  { did: 'did:plc:verified', handle: 'verified.bsky.social' },
  { did: 'did:plc:plain', handle: 'plain.bsky.social' },
]

vi.mock('../../src/lib/search/queryBuilder', () => ({
  searchAccounts: async () => searchResults,
}))

const liveActorsResult: unknown[] = []
vi.mock('../../src/lib/search/liveSearch', () => ({
  searchActorsLive: async (...args: unknown[]) => {
    liveSearchCalls.push(args)
    return liveActorsResult
  },
}))
const liveSearchCalls: unknown[][] = []

// verification rows returned by the enrichment query
// (accountVerifications LEFT JOIN trustedVerifiers LEFT JOIN orgs)
let verificationRows: unknown[] = [
  {
    subjectDid: 'did:plc:verified',
    verifierDid: 'did:plc:tv1',
    tvHandle: 'trusted-verifier.bsky.social',
    orgHandle: null,
  },
]

vi.mock('../../src/db/client', () => ({
  db: {
    select: () => ({
      from: () => ({
        leftJoin: () => ({
          leftJoin: () => ({
            where: async () => verificationRows,
          }),
        }),
      }),
    }),
  },
}))

describe('search route', () => {
  let getActor: () => Promise<{ did: string } | null>

  beforeEach(async () => {
    vi.resetModules()
    getActor = async () => ({ did: 'did:plc:a' })
    verificationRows = [
      {
        subjectDid: 'did:plc:verified',
        verifierDid: 'did:plc:tv1',
        tvHandle: 'trusted-verifier.bsky.social',
        orgHandle: null,
      },
    ]
  })

  it('401 when not logged in', async () => {
    vi.doMock('../../src/lib/authz/session', () => ({ getActor: async () => null }))
    const { POST } = await import('../../src/app/api/search/route')
    const req = new Request('http://x/vidi/api/search', {
      method: 'POST',
      body: JSON.stringify({ orgId: 1, filters: {} }),
    })
    expect((await POST(req as any)).status).toBe(401)
  })

  it('enriches results with a non-empty verifiers array for accounts with a verification row', async () => {
    vi.doMock('../../src/lib/authz/session', () => ({ getActor }))
    const { POST } = await import('../../src/app/api/search/route')
    const req = new Request('http://x/vidi/api/search', {
      method: 'POST',
      body: JSON.stringify({ orgId: 1, filters: {} }),
    })
    const res = await POST(req as any)
    expect(res.status).toBe(200)
    const body = await res.json()
    const verified = body.results.find((r: any) => r.did === 'did:plc:verified')
    expect(verified.verifiers).toEqual([
      { did: 'did:plc:tv1', handle: 'trusted-verifier.bsky.social' },
    ])
  })

  it('returns an empty verifiers array for accounts with no verification row', async () => {
    vi.doMock('../../src/lib/authz/session', () => ({ getActor }))
    const { POST } = await import('../../src/app/api/search/route')
    const req = new Request('http://x/vidi/api/search', {
      method: 'POST',
      body: JSON.stringify({ orgId: 1, filters: {} }),
    })
    const res = await POST(req as any)
    const body = await res.json()
    const plain = body.results.find((r: any) => r.did === 'did:plc:plain')
    expect(plain.verifiers).toEqual([])
  })

  it('falls back to the onboarded org handle when the verifier is not on the trusted verifier list', async () => {
    verificationRows = [
      {
        subjectDid: 'did:plc:verified',
        verifierDid: 'did:plc:self-org',
        tvHandle: null,
        orgHandle: 'atproto-belgium.eurosky.social',
      },
    ]
    vi.doMock('../../src/lib/authz/session', () => ({ getActor }))
    const { POST } = await import('../../src/app/api/search/route')
    const req = new Request('http://x/vidi/api/search', {
      method: 'POST',
      body: JSON.stringify({ orgId: 1, filters: {} }),
    })
    const res = await POST(req as any)
    const body = await res.json()
    const verified = body.results.find((r: any) => r.did === 'did:plc:verified')
    expect(verified.verifiers).toEqual([
      { did: 'did:plc:self-org', handle: 'atproto-belgium.eurosky.social' },
    ])
  })

  it('falls back to the DID string when the verifier is neither a trusted verifier nor an onboarded org', async () => {
    verificationRows = [
      { subjectDid: 'did:plc:verified', verifierDid: 'did:plc:unknown-tv', tvHandle: null, orgHandle: null },
    ]
    vi.doMock('../../src/lib/authz/session', () => ({ getActor }))
    const { POST } = await import('../../src/app/api/search/route')
    const req = new Request('http://x/vidi/api/search', {
      method: 'POST',
      body: JSON.stringify({ orgId: 1, filters: {} }),
    })
    const res = await POST(req as any)
    const body = await res.json()
    const verified = body.results.find((r: any) => r.did === 'did:plc:verified')
    expect(verified.verifiers).toEqual([{ did: 'did:plc:unknown-tv', handle: null }])
  })

  it('does not call live search when liveNetwork is false', async () => {
    liveSearchCalls.length = 0
    vi.doMock('../../src/lib/authz/session', () => ({ getActor }))
    const { POST } = await import('../../src/app/api/search/route')
    const req = new Request('http://x/vidi/api/search', {
      method: 'POST',
      body: JSON.stringify({ orgId: 1, filters: { text: 'namur', liveNetwork: false } }),
    })
    await POST(req as any)
    expect(liveSearchCalls.length).toBe(0)
  })

  it('does not call live search when liveNetwork is true but text is empty', async () => {
    liveSearchCalls.length = 0
    vi.doMock('../../src/lib/authz/session', () => ({ getActor }))
    const { POST } = await import('../../src/app/api/search/route')
    const req = new Request('http://x/vidi/api/search', {
      method: 'POST',
      body: JSON.stringify({ orgId: 1, filters: { text: '', liveNetwork: true } }),
    })
    await POST(req as any)
    expect(liveSearchCalls.length).toBe(0)
  })

  it('merges live results not already in the local index, marking indexed correctly', async () => {
    liveSearchCalls.length = 0
    liveActorsResult.length = 0
    liveActorsResult.push(
      { did: 'did:plc:verified', handle: 'verified.bsky.social', displayName: null, description: null, isCustomDomain: false },
      { did: 'did:plc:live-only', handle: 'newfound.brussels', displayName: 'New', description: null, isCustomDomain: true }
    )
    verificationRows = []
    vi.doMock('../../src/lib/authz/session', () => ({ getActor }))
    const { POST } = await import('../../src/app/api/search/route')
    const req = new Request('http://x/vidi/api/search', {
      method: 'POST',
      body: JSON.stringify({ orgId: 1, filters: { text: 'brussels', liveNetwork: true } }),
    })
    const res = await POST(req as any)
    const body = await res.json()
    expect(liveSearchCalls[0]).toEqual(['brussels', 25])
    // did:plc:verified came from the local mock too -> local (indexed:true) wins, not duplicated
    const verified = body.results.filter((r: any) => r.did === 'did:plc:verified')
    expect(verified).toHaveLength(1)
    expect(verified[0].indexed).toBe(true)
    // did:plc:live-only only came from live search -> indexed:false
    const liveOnly = body.results.find((r: any) => r.did === 'did:plc:live-only')
    expect(liveOnly.indexed).toBe(false)
    expect(liveOnly.handle).toBe('newfound.brussels')
    // did:plc:plain came only from local -> indexed:true
    const plain = body.results.find((r: any) => r.did === 'did:plc:plain')
    expect(plain.indexed).toBe(true)
  })

  it('filters live results by customDomainOnly when that filter is also set', async () => {
    liveSearchCalls.length = 0
    liveActorsResult.length = 0
    liveActorsResult.push(
      { did: 'did:plc:live-domain', handle: 'x.brussels', displayName: null, description: null, isCustomDomain: true },
      { did: 'did:plc:live-platform', handle: 'y.bsky.social', displayName: null, description: null, isCustomDomain: false }
    )
    verificationRows = []
    vi.doMock('../../src/lib/authz/session', () => ({ getActor }))
    const { POST } = await import('../../src/app/api/search/route')
    const req = new Request('http://x/vidi/api/search', {
      method: 'POST',
      body: JSON.stringify({ orgId: 1, filters: { text: 'x', liveNetwork: true, customDomainOnly: true } }),
    })
    const res = await POST(req as any)
    const body = await res.json()
    expect(body.results.find((r: any) => r.did === 'did:plc:live-domain')).toBeTruthy()
    expect(body.results.find((r: any) => r.did === 'did:plc:live-platform')).toBeUndefined()
  })
})
