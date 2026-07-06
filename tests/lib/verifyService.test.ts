import { describe, it, expect, vi } from 'vitest'
const createRecord = vi.fn()
vi.mock('../../src/lib/atproto/orgAgent', () => ({ getOrgAgent: async () => ({ com: { atproto: { repo: { createRecord } } } }) }))
vi.mock('../../src/lib/verify/guardrails', () => ({ checkGuards: async () => ({ ok: false, reason: 'duplicate' }) }))
vi.mock('../../src/db/client', () => ({ db: { insert: () => ({ values: () => ({ onConflictDoUpdate: async () => {}, returning: async () => [{}] }) }) } }))
import { verifyOne } from '../../src/lib/verify/verifyService'
describe('verifyOne', () => {
  it('skips duplicates without writing a record', async () => {
    const res = await verifyOne({ org: { id: 1, did: 'did:plc:org' }, actorDid: 'did:plc:a', subject: { did: 'did:plc:s', handle: 's.bsky.social' } })
    expect(res.outcome).toBe('skipped-duplicate')
    expect(createRecord).not.toHaveBeenCalled()
  })
})
