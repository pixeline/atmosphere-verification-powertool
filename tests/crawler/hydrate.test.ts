import { describe, it, expect } from 'vitest'
import { toAccountRow } from '../../src/crawler/hydrate'

describe('toAccountRow', () => {
  it('derives isCustomDomain from handle', () => {
    const row = toAccountRow({ did: 'did:plc:a', handle: 'x.brussels', displayName: 'X', description: 'bio', avatar: 'u' } as any, 'keyword')
    expect(row.isCustomDomain).toBe(true)
    expect(row.seedSource).toBe('keyword')
  })
})
