import { describe, it, expect } from 'vitest'
import { buildConditions } from '../../src/lib/search/queryBuilder'

describe('buildConditions', () => {
  it('produces a condition per active filter', () => {
    const conds = buildConditions({ text: '🇧🇪', customDomainOnly: true, followedByVerified: true })
    expect(conds).toHaveLength(3) // text, customDomain, followedByVerified
  })
  it('is empty when no filters set', () => {
    expect(buildConditions({})).toHaveLength(0)
  })

  it('adds a condition when activeWithinDays is set', () => {
    expect(buildConditions({ activeWithinDays: 30 })).toHaveLength(1)
  })
  it('adds no condition when activeWithinDays is null or absent', () => {
    expect(buildConditions({ activeWithinDays: null })).toHaveLength(0)
    expect(buildConditions({})).toHaveLength(0)
  })

  it('adds a condition when excludeVerifiedByUs is set and a current org DID is provided', () => {
    expect(buildConditions({ excludeVerifiedByUs: true }, 'did:plc:ourorg')).toHaveLength(1)
  })
  it('adds no condition when excludeVerifiedByUs is set but no current org DID is provided', () => {
    expect(buildConditions({ excludeVerifiedByUs: true }, null)).toHaveLength(0)
  })
  it('adds no condition when excludeVerifiedByUs is false, even with a current org DID', () => {
    expect(buildConditions({ excludeVerifiedByUs: false }, 'did:plc:ourorg')).toHaveLength(0)
  })
})
