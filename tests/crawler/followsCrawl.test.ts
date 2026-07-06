import { describe, it, expect } from 'vitest'
import { collectFollowedByVerified } from '../../src/crawler/followsCrawl'

const agent = {
  getFollows: async ({ actor }: any) => ({ data: { follows: [{ did: 'did:plc:cand' }], cursor: undefined } }),
} as any

describe('collectFollowedByVerified', () => {
  it('maps followed accounts to their verified followers', async () => {
    const map = await collectFollowedByVerified(agent, ['did:plc:v1', 'did:plc:v2'])
    expect(map.get('did:plc:cand')!.sort()).toEqual(['did:plc:v1', 'did:plc:v2'])
  })
})
