import { describe, it, expect, beforeAll, vi } from 'vitest'
import crypto from 'node:crypto'

const rows = new Map<string, string>()
vi.mock('../../src/db/client', () => ({
  db: {
    insert: () => ({ values: (v: any) => ({ onConflictDoUpdate: async () => { rows.set(v.key ?? v.did, v.payload) } }) }),
    select: () => ({ from: () => ({ where: async () => {
      const only = [...rows.entries()][0]; return only ? [{ payload: only[1] }] : []
    } }) }),
    delete: () => ({ where: async () => { rows.clear() } }),
  },
}))

let PgSessionStore: any
beforeAll(async () => {
  process.env.VIDI_TOKEN_ENC_KEY = crypto.randomBytes(32).toString('base64')
  ;({ PgSessionStore } = await import('../../src/lib/atproto/stores'))
})

describe('PgSessionStore', () => {
  it('encrypts on set and decrypts on get', async () => {
    const store = new PgSessionStore()
    await store.set('did:plc:x', { tokenSet: { refresh_token: 'secret' } } as any)
    expect(rows.get('did:plc:x')).not.toContain('secret')
    const got = await store.get('did:plc:x')
    expect((got as any).tokenSet.refresh_token).toBe('secret')
  })
})
