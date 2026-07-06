import { describe, it, expect, vi } from 'vitest'
vi.mock('../../src/lib/authz/session', () => ({ getActor: async () => ({ did: 'did:plc:helper' }) }))
vi.mock('../../src/lib/authz/membership', async (orig) => {
  const mod: any = await orig()
  return {
    ...mod,
    assertOwner: vi.fn(async () => { throw new mod.AuthzError('owner required') }),
    assertActiveMember: vi.fn(async () => { throw new mod.AuthzError('member required') })
  }
})
import { POST, GET, DELETE } from '../../src/app/api/members/route'
import { NextRequest } from 'next/server'
import * as membership from '../../src/lib/authz/membership'

describe('members invite', () => {
  it('rejects a helper trying to invite', async () => {
    vi.mocked(membership.assertOwner).mockRejectedValueOnce(new membership.AuthzError('owner required'))
    const req = new Request('http://x/vidi/api/members', { method: 'POST', body: JSON.stringify({ orgId: 1, handle: 'x', did: 'did:plc:new' }) })
    const res = await POST(req as any)
    expect(res.status).toBe(403)
  })
})

describe('members list', () => {
  it('rejects a non-member trying to list', async () => {
    vi.mocked(membership.assertActiveMember).mockRejectedValueOnce(new membership.AuthzError('member required'))
    const req = new NextRequest('http://x/vidi/api/members?orgId=1')
    const res = await GET(req)
    expect(res.status).toBe(403)
  })
})

describe('members revoke', () => {
  it('rejects a non-owner trying to revoke', async () => {
    vi.mocked(membership.assertOwner).mockRejectedValueOnce(new membership.AuthzError('owner required'))
    const req = new NextRequest('http://x/vidi/api/members', { method: 'DELETE', body: JSON.stringify({ orgId: 1, memberDid: 'did:plc:x' }) })
    const res = await DELETE(req)
    expect(res.status).toBe(403)
  })
})
