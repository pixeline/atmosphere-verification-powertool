import { describe, it, expect } from 'vitest'
import { resolveTrustedVerifierDids } from '../../src/crawler/trustedVerifiers'
const agent = {
  app: { bsky: { graph: { getList: async ({ list }: any) => ({
    data: { items: [{ subject: { did: `did:plc:${list.slice(-1)}1` } }, { subject: { did: `did:plc:${list.slice(-1)}2` } }], cursor: undefined },
  }) } } },
} as any
describe('resolveTrustedVerifierDids', () => {
  it('dedups DIDs across lists', async () => {
    const dids = await resolveTrustedVerifierDids(agent, ['at://l/a', 'at://l/a'])
    expect(dids.sort()).toEqual(['did:plc:a1', 'did:plc:a2'])
  })
})
