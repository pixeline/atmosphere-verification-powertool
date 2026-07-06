import { describe, it, expect, vi } from 'vitest'

const row = { role: 'helper', status: 'active' }
vi.mock('../../src/db/client', () => ({
  db: { select: () => ({ from: () => ({ where: async () => [row] }) }) },
}))

import { assertActiveMember, assertOwner, AuthzError } from '../../src/lib/authz/membership'

describe('authz', () => {
  it('allows an active member', async () => {
    await expect(assertActiveMember('did:plc:a', 1)).resolves.toBeUndefined()
  })
  it('blocks a helper from owner-only actions', async () => {
    await expect(assertOwner('did:plc:a', 1)).rejects.toBeInstanceOf(AuthzError)
  })
})
