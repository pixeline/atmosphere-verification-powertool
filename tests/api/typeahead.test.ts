import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const searchActorsTypeahead = vi.fn()
const ctorSpy = vi.fn()

vi.mock('@atproto/api', () => ({
  AtpAgent: class {
    constructor(opts: { service: string }) {
      ctorSpy(opts)
      return { app: { bsky: { actor: { searchActorsTypeahead } } } } as any
    }
  },
}))

import { GET } from '../../src/app/api/typeahead/route'

function makeReq(q: string | null) {
  const url = q === null ? 'http://x/vidi/api/typeahead' : `http://x/vidi/api/typeahead?q=${encodeURIComponent(q)}`
  return { nextUrl: new URL(url) } as any
}

describe('typeahead route', () => {
  const originalUrl = process.env.VIDI_TYPEAHEAD_URL

  beforeEach(() => {
    searchActorsTypeahead.mockReset()
    ctorSpy.mockReset()
    delete process.env.VIDI_TYPEAHEAD_URL
  })

  afterEach(() => {
    if (originalUrl === undefined) delete process.env.VIDI_TYPEAHEAD_URL
    else process.env.VIDI_TYPEAHEAD_URL = originalUrl
  })

  it('returns an empty list without calling the agent when q is shorter than 2 chars', async () => {
    const res = await GET(makeReq('a'))
    expect(await res.json()).toEqual({ actors: [] })
    expect(searchActorsTypeahead).not.toHaveBeenCalled()
  })

  it('returns an empty list when q is missing', async () => {
    const res = await GET(makeReq(null))
    expect(await res.json()).toEqual({ actors: [] })
    expect(searchActorsTypeahead).not.toHaveBeenCalled()
  })

  it('queries typeahead with limit 8 and trims the actor shape', async () => {
    searchActorsTypeahead.mockResolvedValue({
      data: {
        actors: [
          {
            did: 'did:plc:a',
            handle: 'alice.bsky.social',
            displayName: 'Alice',
            avatar: 'https://cdn/avatar.jpg',
            extraFieldToTrim: 'nope',
          },
        ],
      },
    })

    const res = await GET(makeReq('al'))

    expect(ctorSpy).toHaveBeenCalledWith({ service: 'https://typeahead.waow.tech' })
    expect(searchActorsTypeahead).toHaveBeenCalledWith({ q: 'al', limit: 8 })
    expect(await res.json()).toEqual({
      actors: [
        { did: 'did:plc:a', handle: 'alice.bsky.social', displayName: 'Alice', avatar: 'https://cdn/avatar.jpg' },
      ],
    })
  })

  it('uses VIDI_TYPEAHEAD_URL when configured', async () => {
    process.env.VIDI_TYPEAHEAD_URL = 'https://custom-typeahead.example'
    searchActorsTypeahead.mockResolvedValue({ data: { actors: [] } })

    await GET(makeReq('bob'))

    expect(ctorSpy).toHaveBeenCalledWith({ service: 'https://custom-typeahead.example' })
  })

  it('returns an empty list when the typeahead agent throws', async () => {
    searchActorsTypeahead.mockRejectedValue(new Error('upstream down'))
    const res = await GET(makeReq('boom'))
    expect(await res.json()).toEqual({ actors: [] })
  })
})
