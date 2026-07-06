import { describe, it, expect, vi, beforeEach } from 'vitest'
vi.mock('../../src/lib/authz/session', () => ({ getActor: async () => ({ did: 'did:plc:a' }) }))
vi.mock('../../src/lib/authz/membership', () => ({ assertActiveMember: async () => {}, AuthzError: class extends Error { status = 403 } }))

// orgResult is mutable per-test so we can simulate an inactive org without
// re-mocking the module.
let orgResult: unknown[] = [{ id: 1, did: 'did:plc:org', status: 'active' }]
vi.mock('../../src/db/client', () => ({ db: { select: () => ({ from: () => ({ where: async () => orgResult }) }) } }))

const revokeOne = vi.fn(async (_arg: unknown) => ({ outcome: 'revoked' }))
vi.mock('../../src/lib/verify/verifyService', () => ({ revokeOne: (arg: unknown) => revokeOne(arg) }))

import { POST } from '../../src/app/api/revoke/route'

beforeEach(() => {
  orgResult = [{ id: 1, did: 'did:plc:org', status: 'active' }]
  revokeOne.mockClear()
})

describe('revoke route org.status gate', () => {
  it('returns 403 org_inactive and does not call revokeOne when the org is suspended', async () => {
    orgResult = [{ id: 1, did: 'did:plc:org', status: 'suspended' }]
    const req = new Request('http://x/vidi/api/revoke', { method: 'POST', body: JSON.stringify({ orgId: 1, subjectDid: 'did:plc:s1' }) })
    const res = await POST(req as any)
    expect(res.status).toBe(403)
    const body = await res.json()
    expect(body.error).toBe('org_inactive')
    expect(revokeOne).not.toHaveBeenCalled()
  })

  it('calls revokeOne when the org is active', async () => {
    const req = new Request('http://x/vidi/api/revoke', { method: 'POST', body: JSON.stringify({ orgId: 1, subjectDid: 'did:plc:s1' }) })
    const res = await POST(req as any)
    expect(res.status).toBe(200)
    expect(revokeOne).toHaveBeenCalledTimes(1)
  })
})
