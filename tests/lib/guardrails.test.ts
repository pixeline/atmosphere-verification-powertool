import { describe, it, expect, vi } from 'vitest'
vi.mock('../../src/db/client', () => ({
  db: { select: () => ({ from: () => ({ where: async () => [] }) }) },
}))
import { checkGuards } from '../../src/lib/verify/guardrails'
describe('checkGuards', () => {
  it('blocks denylisted subjects', async () => {
    process.env.VIDI_DENYLIST_DIDS = 'did:plc:bad'
    const g = await checkGuards('did:plc:org', 'did:plc:bad')
    expect(g).toEqual({ ok: false, reason: 'denylist' })
  })
  it('allows a fresh, non-denylisted subject', async () => {
    process.env.VIDI_DENYLIST_DIDS = ''
    expect(await checkGuards('did:plc:org', 'did:plc:ok')).toEqual({ ok: true })
  })
})
