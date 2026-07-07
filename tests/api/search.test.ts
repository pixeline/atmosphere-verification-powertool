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
})
