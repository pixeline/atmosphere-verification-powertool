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
})
