export type ActivityBucket = { label: string; days: number }

// Ordered smallest-to-largest; both the search filter (SearchForm) and the
// account-card display bucket (AccountCard) import this exact list so they
// can never drift out of sync with each other.
export const ACTIVITY_BUCKETS: ActivityBucket[] = [
  { label: '7 days', days: 7 },
  { label: '2 weeks', days: 14 },
  { label: '1 month', days: 30 },
  { label: '3 months', days: 90 },
  { label: '6 months', days: 180 },
]

export function describeLastActive(lastActiveAt: string | Date | null | undefined): string {
  if (!lastActiveAt) return 'Activity unknown'
  const date = typeof lastActiveAt === 'string' ? new Date(lastActiveAt) : lastActiveAt
  const ageDays = (Date.now() - date.getTime()) / (24 * 60 * 60 * 1000)
  const bucket = ACTIVITY_BUCKETS.find((b) => ageDays <= b.days)
  return bucket ? `Active within ${bucket.label}` : 'Active over 6 months ago'
}
