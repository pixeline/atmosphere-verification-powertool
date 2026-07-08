import { describe, it, expect } from 'vitest'
import { toAccountRow } from '../../src/crawler/hydrate'

describe('toAccountRow', () => {
  it('derives isCustomDomain from handle', () => {
    const row = toAccountRow({ did: 'did:plc:a', handle: 'x.brussels', displayName: 'X', description: 'bio', avatar: 'u' } as any, 'keyword')
    expect(row.isCustomDomain).toBe(true)
    expect(row.seedSource).toBe('keyword')
  })

  it('copies followersCount and followsCount when present', () => {
    const row = toAccountRow({ did: 'did:plc:a', handle: 'x', followersCount: 42, followsCount: 7 } as any, 'crawl')
    expect(row.followersCount).toBe(42)
    expect(row.followsCount).toBe(7)
  })

  it('defaults followersCount and followsCount to null when absent', () => {
    const row = toAccountRow({ did: 'did:plc:a', handle: 'x' } as any, 'crawl')
    expect(row.followersCount).toBeNull()
    expect(row.followsCount).toBeNull()
  })
})
