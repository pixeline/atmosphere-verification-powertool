import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../src/lib/authz/session', () => ({ getActor: async () => ({ did: 'did:plc:a' }) }))
vi.mock('../../src/lib/authz/membership', () => ({
  assertActiveMember: async () => {},
  AuthzError: class extends Error {
    status = 403
  },
}))

// Records every insert's values. Discriminate by shape rather than Drizzle
// table identity: an accounts row always has `handle`; a backlogItems row
// always has `subjectDid` + `status` and never `handle`.
const insertedValues: Record<string, unknown>[] = []
vi.mock('../../src/db/client', () => ({
  db: {
    insert: () => ({
      values: (values: Record<string, unknown>) => {
        insertedValues.push(values)
        return { onConflictDoUpdate: async () => {} }
      },
    }),
  },
}))

import { POST } from '../../src/app/api/backlog/route'

beforeEach(() => {
  insertedValues.length = 0
})

describe('backlog route account upsert', () => {
  it('upserts an accounts row when handle is provided (live-only result)', async () => {
    const req = new Request('http://x/vidi/api/backlog', {
      method: 'POST',
      body: JSON.stringify({
        orgId: 1,
        subjectDid: 'did:plc:live',
        handle: 'newfound.brussels',
        displayName: 'New',
        description: 'bio',
        isCustomDomain: true,
      }),
    })
    await POST(req as any)
    const accountsInsert = insertedValues.find((v) => 'handle' in v)
    expect(accountsInsert).toBeTruthy()
    expect(accountsInsert!.handle).toBe('newfound.brussels')
    expect(accountsInsert!.isCustomDomain).toBe(true)
    const backlogInsert = insertedValues.find((v) => 'subjectDid' in v && 'status' in v)
    expect(backlogInsert).toBeTruthy()
  })

  it('does not touch accounts when handle is absent (already-indexed result)', async () => {
    const req = new Request('http://x/vidi/api/backlog', {
      method: 'POST',
      body: JSON.stringify({ orgId: 1, subjectDid: 'did:plc:indexed' }),
    })
    await POST(req as any)
    const accountsInsert = insertedValues.find((v) => 'handle' in v)
    expect(accountsInsert).toBeUndefined()
    const backlogInsert = insertedValues.find((v) => 'subjectDid' in v && 'status' in v)
    expect(backlogInsert).toBeTruthy()
  })
})
