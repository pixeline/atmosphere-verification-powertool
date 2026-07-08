import { describe, it, expect } from 'vitest'
import { ACTIVITY_BUCKETS, describeLastActive } from '../../src/lib/activityBuckets'

describe('ACTIVITY_BUCKETS', () => {
  it('is ordered smallest to largest with the expected five buckets', () => {
    expect(ACTIVITY_BUCKETS.map((b) => b.days)).toEqual([7, 14, 30, 90, 180])
    expect(ACTIVITY_BUCKETS.map((b) => b.label)).toEqual([
      '7 days', '2 weeks', '1 month', '3 months', '6 months',
    ])
  })
})

describe('describeLastActive', () => {
  it('returns "Activity unknown" for null/undefined', () => {
    expect(describeLastActive(null)).toBe('Activity unknown')
    expect(describeLastActive(undefined)).toBe('Activity unknown')
  })

  it('buckets a timestamp 3 days ago into the 7-day bucket', () => {
    const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString()
    expect(describeLastActive(threeDaysAgo)).toBe('Active within 7 days')
  })

  it('buckets a timestamp exactly 7 days ago into the 7-day bucket (inclusive boundary)', () => {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
    expect(describeLastActive(sevenDaysAgo)).toBe('Active within 7 days')
  })

  it('buckets a timestamp 45 days ago into the 3-month bucket', () => {
    const fortyFiveDaysAgo = new Date(Date.now() - 45 * 24 * 60 * 60 * 1000).toISOString()
    expect(describeLastActive(fortyFiveDaysAgo)).toBe('Active within 3 months')
  })

  it('returns the over-6-months catch-all for anything past the largest bucket', () => {
    const overSixMonths = new Date(Date.now() - 200 * 24 * 60 * 60 * 1000).toISOString()
    expect(describeLastActive(overSixMonths)).toBe('Active over 6 months ago')
  })

  it('accepts a Date instance as well as a string', () => {
    const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000)
    expect(describeLastActive(twoDaysAgo)).toBe('Active within 7 days')
  })
})
