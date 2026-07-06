import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

let seedRows: Array<{ id: number; keyword: string; enabled: boolean }> = []

vi.mock('../../src/db/client', () => ({
  db: {
    select: () => ({
      from: () => ({
        where: async () => seedRows,
      }),
    }),
  },
}))

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

import { runKeywordSeed } from '../../src/crawler/keywordSeed'

describe('runKeywordSeed', () => {
  const originalUrl = process.env.VIDI_TYPEAHEAD_URL

  beforeEach(() => {
    seedRows = []
    searchActorsTypeahead.mockReset()
    ctorSpy.mockReset()
    delete process.env.VIDI_TYPEAHEAD_URL
  })

  afterEach(() => {
    if (originalUrl === undefined) delete process.env.VIDI_TYPEAHEAD_URL
    else process.env.VIDI_TYPEAHEAD_URL = originalUrl
  })

  it('defaults to https://typeahead.waow.tech when VIDI_TYPEAHEAD_URL is unset', async () => {
    seedRows = [{ id: 1, keyword: 'brussels', enabled: true }]
    searchActorsTypeahead.mockResolvedValue({ data: { actors: [] } })

    await runKeywordSeed({} as any)

    expect(ctorSpy).toHaveBeenCalledWith({ service: 'https://typeahead.waow.tech' })
  })

  it('uses VIDI_TYPEAHEAD_URL when configured', async () => {
    process.env.VIDI_TYPEAHEAD_URL = 'https://custom-typeahead.example'
    seedRows = [{ id: 1, keyword: 'brussels', enabled: true }]
    searchActorsTypeahead.mockResolvedValue({ data: { actors: [] } })

    await runKeywordSeed({} as any)

    expect(ctorSpy).toHaveBeenCalledWith({ service: 'https://custom-typeahead.example' })
  })

  it('calls searchActorsTypeahead per enabled seed keyword and dedupes DIDs', async () => {
    seedRows = [
      { id: 1, keyword: 'brussels', enabled: true },
      { id: 2, keyword: 'belgium', enabled: true },
    ]
    searchActorsTypeahead
      .mockResolvedValueOnce({ data: { actors: [{ did: 'did:plc:a' }, { did: 'did:plc:b' }] } })
      .mockResolvedValueOnce({ data: { actors: [{ did: 'did:plc:b' }, { did: 'did:plc:c' }] } })

    const dids = await runKeywordSeed({} as any)

    expect(searchActorsTypeahead).toHaveBeenCalledTimes(2)
    expect(searchActorsTypeahead).toHaveBeenNthCalledWith(1, { q: 'brussels', limit: 100 })
    expect(searchActorsTypeahead).toHaveBeenNthCalledWith(2, { q: 'belgium', limit: 100 })
    expect(dids.sort()).toEqual(['did:plc:a', 'did:plc:b', 'did:plc:c'])
  })

  it('returns an empty array when there are no enabled seeds', async () => {
    seedRows = []
    const dids = await runKeywordSeed({} as any)
    expect(dids).toEqual([])
    expect(searchActorsTypeahead).not.toHaveBeenCalled()
  })
})
