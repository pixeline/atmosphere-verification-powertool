import { describe, it, expect, vi, beforeEach } from 'vitest'

describe('mapVerificationRecords', () => {
  it('maps records to verification edges', () => {
    const edges = mapVerificationRecords('did:plc:tv', [
      { uri: 'at://did:plc:tv/app.bsky.graph.verification/abc', value: { subject: 'did:plc:sub', handle: 'x', displayName: 'X', createdAt: '2026-01-01T00:00:00Z' } },
    ])
    expect(edges[0]).toEqual({ subjectDid: 'did:plc:sub', verifierDid: 'did:plc:tv', recordUri: 'at://did:plc:tv/app.bsky.graph.verification/abc', createdAt: '2026-01-01T00:00:00Z' })
  })
})

// com.atproto.repo.listRecords can only be answered by the PDS that actually
// hosts a given repo. crawlVerifications must resolve each verifier DID's
// own PDS (via @atproto/identity) and query that PDS specifically — not a
// single shared AppView agent, which 501s for any verifier not hosted on
// that exact backend.
const resolveAtprotoData = vi.fn()
vi.mock('@atproto/identity', () => ({
  IdResolver: class {
    did = { resolveAtprotoData: (did: string) => resolveAtprotoData(did) }
  },
}))

const listRecords = vi.fn()
const constructedServices: string[] = []
vi.mock('@atproto/api', () => ({
  AtpAgent: class {
    constructor(opts: { service: string }) {
      constructedServices.push(opts.service)
      return { com: { atproto: { repo: { listRecords: (args: unknown) => listRecords(args) } } } } as any
    }
  },
}))

const inserted: Record<string, unknown>[] = []
vi.mock('../../src/db/client', () => ({
  db: {
    insert: () => ({
      values: (v: Record<string, unknown>) => ({
        onConflictDoUpdate: async () => {
          inserted.push(v)
        },
      }),
    }),
  },
}))

import { crawlVerifications, mapVerificationRecords } from '../../src/crawler/verificationsCrawl'

beforeEach(() => {
  resolveAtprotoData.mockReset()
  listRecords.mockReset()
  constructedServices.length = 0
  inserted.length = 0
})

describe('crawlVerifications', () => {
  it("queries each verifier at its own resolved PDS, not a single shared agent", async () => {
    resolveAtprotoData.mockImplementation(async (did: string) => ({
      did,
      handle: 'x',
      signingKey: 'y',
      pds: did === 'did:plc:a' ? 'https://pds-a.example' : 'https://pds-b.example',
    }))
    listRecords.mockResolvedValue({ data: { records: [], cursor: undefined } })

    await crawlVerifications(['did:plc:a', 'did:plc:b'])

    expect(constructedServices).toEqual(['https://pds-a.example', 'https://pds-b.example'])
  })

  it('isolates a failure resolving one verifier so the others are still crawled', async () => {
    resolveAtprotoData.mockImplementation(async (did: string) => {
      if (did === 'did:plc:bad') throw new Error('boom')
      return { did, handle: 'x', signingKey: 'y', pds: 'https://pds-good.example' }
    })
    listRecords.mockResolvedValue({
      data: {
        records: [
          { uri: 'at://did:plc:good/app.bsky.graph.verification/1', value: { subject: 'did:plc:sub', createdAt: '2026-01-01T00:00:00Z' } },
        ],
        cursor: undefined,
      },
    })

    const edges = await crawlVerifications(['did:plc:bad', 'did:plc:good'])

    expect(edges).toHaveLength(1)
    expect(edges[0].verifierDid).toBe('did:plc:good')
  })

  it('writes each discovered edge to accountVerifications', async () => {
    resolveAtprotoData.mockResolvedValue({ did: 'did:plc:a', handle: 'x', signingKey: 'y', pds: 'https://pds-a.example' })
    listRecords.mockResolvedValue({
      data: {
        records: [
          { uri: 'at://did:plc:a/app.bsky.graph.verification/1', value: { subject: 'did:plc:sub', createdAt: '2026-01-01T00:00:00Z' } },
        ],
        cursor: undefined,
      },
    })

    await crawlVerifications(['did:plc:a'])

    expect(inserted).toHaveLength(1)
    expect(inserted[0]).toMatchObject({ subjectDid: 'did:plc:sub', verifierDid: 'did:plc:a' })
  })
})
