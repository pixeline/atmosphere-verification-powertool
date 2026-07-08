import { describe, it, expect, vi, beforeEach } from 'vitest'

const inserted: Record<string, unknown>[] = []
const conflicts: unknown[] = []
vi.mock('../../src/db/client', () => ({
  db: {
    insert: () => ({
      values: (values: Record<string, unknown>) => ({
        onConflictDoUpdate: async (conflict: unknown) => {
          inserted.push(values)
          conflicts.push(conflict)
        },
      }),
    }),
  },
}))

import { resolveTrustedVerifierDids, syncTrustedVerifiers } from '../../src/crawler/trustedVerifiers'

const agent = {
  app: {
    bsky: {
      graph: {
        getList: async ({ list }: any) => ({
          data: {
            items: [
              { subject: { did: `did:plc:${list.slice(-1)}1`, handle: `one.${list.slice(-1)}.example` } },
              { subject: { did: `did:plc:${list.slice(-1)}2`, handle: `two.${list.slice(-1)}.example` } },
            ],
            cursor: undefined,
          },
        }),
      },
    },
  },
} as any

describe('resolveTrustedVerifierDids', () => {
  it('dedups entries across lists and captures each handle alongside its DID', async () => {
    const entries = await resolveTrustedVerifierDids(agent, ['at://l/a', 'at://l/a'])
    expect(entries.map((e) => e.did).sort()).toEqual(['did:plc:a1', 'did:plc:a2'])
    expect(entries.find((e) => e.did === 'did:plc:a1')?.handle).toBe('one.a.example')
    expect(entries.find((e) => e.did === 'did:plc:a2')?.handle).toBe('two.a.example')
  })
})

describe('syncTrustedVerifiers', () => {
  beforeEach(() => {
    inserted.length = 0
    conflicts.length = 0
    process.env.TRUSTED_VERIFIER_LIST_URIS = 'at://l/a'
  })

  it('persists each verifier with its handle, refreshing the handle on re-crawl', async () => {
    const dids = await syncTrustedVerifiers(agent)

    expect(dids.sort()).toEqual(['did:plc:a1', 'did:plc:a2'])
    const row = inserted.find((r) => r.did === 'did:plc:a1')
    expect(row).toMatchObject({ did: 'did:plc:a1', handle: 'one.a.example', sourceListUri: 'at://l/a' })
    // onConflictDoUpdate (not onConflictDoNothing) so a changed handle is
    // actually refreshed on the next crawl, not stuck at its first value.
    expect(conflicts[0]).toBeTruthy()
  })
})
