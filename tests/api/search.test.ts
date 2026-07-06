import { describe, it, expect, vi } from 'vitest'

vi.mock('../../src/lib/authz/session', () => ({ getActor: async () => null }))

import { POST } from '../../src/app/api/search/route'

describe('search route', () => {
  it('401 when not logged in', async () => {
    const req = new Request('http://x/vidi/api/search', {
      method: 'POST',
      body: JSON.stringify({ orgId: 1, filters: {} }),
    })
    expect((await POST(req as any)).status).toBe(401)
  })
})
