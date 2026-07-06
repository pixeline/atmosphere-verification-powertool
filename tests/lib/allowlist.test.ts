import { describe, it, expect } from 'vitest'
import { isSuperadmin } from '../../src/lib/allowlist'
describe('isSuperadmin', () => {
  it('matches configured DIDs only', () => {
    process.env.VIDI_SUPERADMIN_DIDS = 'did:plc:a, did:plc:b'
    expect(isSuperadmin('did:plc:a')).toBe(true)
    expect(isSuperadmin('did:plc:z')).toBe(false)
  })
})
