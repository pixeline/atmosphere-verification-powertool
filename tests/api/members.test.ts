import { describe, it, expect, vi } from 'vitest'
vi.mock('../../src/lib/authz/session', () => ({ getActor: async () => ({ did: 'did:plc:helper' }) }))
vi.mock('../../src/lib/authz/membership', async (orig) => {
  const mod: any = await orig()
  return { ...mod, assertOwner: async () => { throw new mod.AuthzError('owner required') } }
})
import { POST } from '../../src/app/api/members/route'
describe('members invite', () => {
  it('rejects a helper trying to invite', async () => {
    const req = new Request('http://x/vidi/api/members', { method: 'POST', body: JSON.stringify({ orgId: 1, handle: 'x', did: 'did:plc:new' }) })
    const res = await POST(req as any)
    expect(res.status).toBe(403)
  })
})
