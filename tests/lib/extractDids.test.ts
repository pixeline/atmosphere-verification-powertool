import { describe, it, expect } from 'vitest'
import { extractDids } from '../../src/lib/extractDids'

describe('extractDids', () => {
  it('finds DIDs in any column and dedupes them', () => {
    const text = 'handle,did\na.be,did:plc:22e257wwxrbho4emycurotpi\nb.be,"did:plc:22e257wwxrbho4emycurotpi"\nc,did:web:example.com\n'
    expect(extractDids(text)).toEqual(['did:plc:22e257wwxrbho4emycurotpi', 'did:web:example.com'])
  })

  it('returns nothing for a handle-only file', () => {
    expect(extractDids('handle\nalice.be\n')).toEqual([])
  })
})
