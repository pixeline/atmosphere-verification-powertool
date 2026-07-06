import { describe, it, expect } from 'vitest'
import { isCustomDomain } from '../../src/lib/domain/handleClassifier'
describe('isCustomDomain', () => {
  it('flags platform handles as non-custom', () => {
    expect(isCustomDomain('alice.bsky.social')).toBe(false)
    expect(isCustomDomain('bob.mu.social')).toBe(false)
    expect(isCustomDomain('x.eurosky.social')).toBe(false)
  })
  it('flags real domains as custom', () => {
    expect(isCustomDomain('france-atmosphe.re')).toBe(true)
    expect(isCustomDomain('jan.brussels')).toBe(true)
  })
})
