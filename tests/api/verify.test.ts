import { describe, it, expect, vi } from 'vitest'
vi.mock('../../src/lib/authz/session', () => ({ getActor: async () => ({ did: 'did:plc:a' }) }))
vi.mock('../../src/lib/authz/membership', () => ({ assertActiveMember: async () => {}, AuthzError: class extends Error { status = 403 } }))
vi.mock('../../src/db/client', () => ({ db: { select: () => ({ from: () => ({ where: async () => [{ id: 1, did: 'did:plc:org' }] }) }) } }))
vi.mock('../../src/lib/verify/verifyService', () => ({ verifyOne: async ({ subject }: any) => ({ did: subject.did, outcome: 'verified' }) }))
import { POST } from '../../src/app/api/verify/route'
describe('verify route batch cap', () => {
  it('rejects oversized batches', async () => {
    process.env.VIDI_BATCH_MAX = '2'
    const subjects = Array.from({ length: 3 }, (_, i) => ({ did: `did:plc:${i}`, handle: `h${i}` }))
    const req = new Request('http://x/vidi/api/verify', { method: 'POST', body: JSON.stringify({ orgId: 1, subjects }) })
    expect((await POST(req as any)).status).toBe(400)
  })
})
