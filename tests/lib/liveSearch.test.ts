import { describe, it, expect, vi } from 'vitest'

const searchActors = vi.fn()
vi.mock('@atproto/api', () => ({
  AtpAgent: class {
    app = { bsky: { actor: { searchActors } } }
  },
}))

import { searchActorsLive } from '../../src/lib/search/liveSearch'

describe('searchActorsLive', () => {
  it('maps actors to LiveActor shape and derives isCustomDomain', async () => {
    searchActors.mockResolvedValue({
      data: {
        actors: [
          { did: 'did:plc:a', handle: 'jan.brussels', displayName: 'Jan', description: 'bio' },
          { did: 'did:plc:b', handle: 'x.bsky.social' },
        ],
      },
    })
    const results = await searchActorsLive('brussels')
    expect(searchActors).toHaveBeenCalledWith({ q: 'brussels', limit: 25 })
    expect(results).toEqual([
      { did: 'did:plc:a', handle: 'jan.brussels', displayName: 'Jan', description: 'bio', isCustomDomain: true },
      { did: 'did:plc:b', handle: 'x.bsky.social', displayName: null, description: null, isCustomDomain: false },
    ])
  })

  it('respects a custom limit', async () => {
    searchActors.mockResolvedValue({ data: { actors: [] } })
    await searchActorsLive('gent', 10)
    expect(searchActors).toHaveBeenCalledWith({ q: 'gent', limit: 10 })
  })
})
