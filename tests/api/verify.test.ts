import { describe, it, expect, vi, beforeEach } from 'vitest'
vi.mock('../../src/lib/authz/session', () => ({ getActor: async () => ({ did: 'did:plc:a' }) }))
vi.mock('../../src/lib/authz/membership', () => ({ assertActiveMember: async () => {}, AuthzError: class extends Error { status = 403 } }))

// orgResult is mutable per-test so we can simulate an inactive org without
// re-mocking the module.
let orgResult: unknown[] = [{ id: 1, did: 'did:plc:org', status: 'active' }]
vi.mock('../../src/db/client', () => ({ db: { select: () => ({ from: () => ({ where: async () => orgResult }) }) } }))

const verifyOne = vi.fn(async ({ subject }: any) => ({ did: subject.did, outcome: 'verified' }))
vi.mock('../../src/lib/verify/verifyService', () => ({ verifyOne: (arg: unknown) => verifyOne(arg) }))

const invalidate = vi.fn()
vi.mock('../../src/lib/verify/verifiedCount', () => ({ invalidateOrgVerificationCount: (did: string) => invalidate(did) }))

import { POST } from '../../src/app/api/verify/route'

beforeEach(() => {
  orgResult = [{ id: 1, did: 'did:plc:org', status: 'active' }]
  verifyOne.mockClear()
  invalidate.mockClear()
})

describe('verify route batch cap', () => {
  it('rejects oversized batches', async () => {
    process.env.VIDI_BATCH_MAX = '2'
    const subjects = Array.from({ length: 3 }, (_, i) => ({ did: `did:plc:${i}`, handle: `h${i}` }))
    const req = new Request('http://x/vidi/api/verify', { method: 'POST', body: JSON.stringify({ orgId: 1, subjects }) })
    expect((await POST(req as any)).status).toBe(400)
  })
})

describe('verify route org.status gate', () => {
  it('returns 403 org_inactive and does not call verifyOne when the org is suspended', async () => {
    orgResult = [{ id: 1, did: 'did:plc:org', status: 'suspended' }]
    const subjects = [{ did: 'did:plc:s1', handle: 'h1' }]
    const req = new Request('http://x/vidi/api/verify', { method: 'POST', body: JSON.stringify({ orgId: 1, subjects }) })
    const res = await POST(req as any)
    expect(res.status).toBe(403)
    const body = await res.json()
    expect(body.error).toBe('org_inactive')
    expect(verifyOne).not.toHaveBeenCalled()
    // A rejected verify must not bust the count cache.
    expect(invalidate).not.toHaveBeenCalled()
  })
})

describe('verify route count-cache invalidation', () => {
  it('invalidates the org verified-count cache after a successful verify', async () => {
    process.env.VIDI_BATCH_MAX = '50'
    const subjects = [{ did: 'did:plc:s1', handle: 'h1' }]
    const req = new Request('http://x/vidi/api/verify', { method: 'POST', body: JSON.stringify({ orgId: 1, subjects }) })
    const res = await POST(req as any)
    expect(res.status).toBe(200)
    expect(verifyOne).toHaveBeenCalledTimes(1)
    expect(invalidate).toHaveBeenCalledWith('did:plc:org')
  })
})
