import { describe, it, expect, vi, beforeEach } from 'vitest'

const staleRows: { did: string }[] = [{ did: 'did:plc:stale1' }, { did: 'did:plc:stale2' }]
let selectRows = staleRows

vi.mock('../../src/db/client', () => ({
  db: {
    select: () => ({ from: () => ({ where: async () => selectRows }) }),
    update: () => ({
      set: (values: Record<string, unknown>) => ({
        where: async () => {
          updateCalls.push(values)
        },
      }),
    }),
  },
}))

const updateCalls: Record<string, unknown>[] = []

import { refreshLastActive } from '../../src/crawler/refreshLastActive'

beforeEach(() => {
  selectRows = staleRows
  updateCalls.length = 0
})

describe('refreshLastActive', () => {
  it('writes lastActiveAt from the most recent post and stamps lastActiveCheckedAt', async () => {
    const getAuthorFeed = vi.fn(async ({ actor }: { actor: string }) => ({
      data: {
        feed:
          actor === 'did:plc:stale1'
            ? [{ post: { indexedAt: '2026-01-01T00:00:00.000Z' } }]
            : [],
      },
    }))
    const agent = { app: { bsky: { feed: { getAuthorFeed } } } } as any

    await refreshLastActive(agent)

    expect(getAuthorFeed).toHaveBeenCalledTimes(2)
    const withPost = updateCalls.find((c) => c.lastActiveAt instanceof Date && (c.lastActiveAt as Date).toISOString() === '2026-01-01T00:00:00.000Z')
    expect(withPost).toBeTruthy()
    // An account with zero posts still gets stamped (lastActiveAt: null,
    // lastActiveCheckedAt: now) so it isn't re-checked every single crawl.
    const withoutPost = updateCalls.find((c) => c.lastActiveAt === null)
    expect(withoutPost).toBeTruthy()
    expect(updateCalls.every((c) => c.lastActiveCheckedAt instanceof Date)).toBe(true)
  })

  it('isolates a failure fetching one account so the others are still refreshed', async () => {
    const getAuthorFeed = vi.fn(async ({ actor }: { actor: string }) => {
      if (actor === 'did:plc:stale1') throw new Error('boom')
      return { data: { feed: [{ post: { indexedAt: '2026-02-02T00:00:00.000Z' } }] } }
    })
    const agent = { app: { bsky: { feed: { getAuthorFeed } } } } as any

    await refreshLastActive(agent)

    // The failing account is NOT stamped (so it's retried next crawl, not
    // left stale for a full 7 days on a transient failure); the other is.
    expect(updateCalls).toHaveLength(1)
    expect((updateCalls[0].lastActiveAt as Date).toISOString()).toBe('2026-02-02T00:00:00.000Z')
  })

  it('does nothing when there are no stale/unchecked accounts', async () => {
    selectRows = []
    const getAuthorFeed = vi.fn()
    const agent = { app: { bsky: { feed: { getAuthorFeed } } } } as any

    await refreshLastActive(agent)

    expect(getAuthorFeed).not.toHaveBeenCalled()
    expect(updateCalls).toHaveLength(0)
  })
})
