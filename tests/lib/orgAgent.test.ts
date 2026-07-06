import { describe, it, expect, vi } from 'vitest'

const restore = vi.fn(async (did: string) => ({ did, fetchHandler: async () => new Response() }))

vi.mock('../../src/lib/atproto/oauthClient', () => ({
  getOAuthClient: async () => ({ restore }),
}))

import { getOrgAgent } from '../../src/lib/atproto/orgAgent'

describe('getOrgAgent', () => {
  it('restores the org session by did and returns an Agent built from it', async () => {
    const agent = await getOrgAgent('did:plc:org')
    expect(restore).toHaveBeenCalledWith('did:plc:org')
    expect((agent as any).did).toBe('did:plc:org')
  })
})
