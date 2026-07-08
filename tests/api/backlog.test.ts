import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../src/lib/authz/session', () => ({ getActor: async () => ({ did: 'did:plc:a' }) }))
vi.mock('../../src/lib/authz/membership', () => ({
  assertActiveMember: async () => {},
  AuthzError: class extends Error {
    status = 403
  },
}))

// The backlog route re-resolves identity from the network (mirroring
// verifyService) rather than trusting client-supplied profile fields — mock
// @atproto/api so tests can assert THAT this is what supplies the stored handle.
const publicGetProfile = vi.fn()
vi.mock('@atproto/api', () => ({
  AtpAgent: class {
    constructor() {
      return { getProfile: publicGetProfile } as any
    }
  },
}))

// Records every insert's values, and lets tests control what `select` returns
// (an empty array simulates a not-yet-indexed subject). Discriminate inserts
// by shape rather than Drizzle table identity: an accounts row always has
// `handle`; a backlogItems row always has `subjectDid` + `status` and never `handle`.
const insertedValues: Record<string, unknown>[] = []
let selectResult: unknown[] = []
vi.mock('../../src/db/client', () => ({
  db: {
    select: () => ({ from: () => ({ where: async () => selectResult }) }),
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
  selectResult = []
  publicGetProfile.mockReset()
})

describe('backlog route account upsert', () => {
  it('upserts an accounts row (server-resolved identity) when handle hints a live-only, not-yet-indexed result', async () => {
    publicGetProfile.mockResolvedValue({
      data: { handle: 'newfound.brussels', displayName: 'New', description: 'bio', avatar: null },
    })
    const req = new Request('http://x/vidi/api/backlog', {
      method: 'POST',
      body: JSON.stringify({ orgId: 1, subjectDid: 'did:plc:live', handle: 'newfound.brussels' }),
    })
    await POST(req as any)
    expect(publicGetProfile).toHaveBeenCalledWith({ actor: 'did:plc:live' })
    const accountsInsert = insertedValues.find((v) => 'handle' in v)
    expect(accountsInsert).toBeTruthy()
    expect(accountsInsert!.handle).toBe('newfound.brussels')
    const backlogInsert = insertedValues.find((v) => 'subjectDid' in v && 'status' in v)
    expect(backlogInsert).toBeTruthy()
  })

  it('does not touch accounts when handle is absent (already-indexed result)', async () => {
    const req = new Request('http://x/vidi/api/backlog', {
      method: 'POST',
      body: JSON.stringify({ orgId: 1, subjectDid: 'did:plc:indexed' }),
    })
    await POST(req as any)
    expect(publicGetProfile).not.toHaveBeenCalled()
    const accountsInsert = insertedValues.find((v) => 'handle' in v)
    expect(accountsInsert).toBeUndefined()
    const backlogInsert = insertedValues.find((v) => 'subjectDid' in v && 'status' in v)
    expect(backlogInsert).toBeTruthy()
  })

  it('does not touch accounts when the subject is already indexed, even if handle is provided', async () => {
    selectResult = [{ did: 'did:plc:already', handle: 'existing.example' }]
    const req = new Request('http://x/vidi/api/backlog', {
      method: 'POST',
      body: JSON.stringify({ orgId: 1, subjectDid: 'did:plc:already', handle: 'whatever.example' }),
    })
    await POST(req as any)
    expect(publicGetProfile).not.toHaveBeenCalled()
    const accountsInsert = insertedValues.find((v) => 'handle' in v)
    expect(accountsInsert).toBeUndefined()
  })

  it('ignores a client-supplied handle and stores the server-resolved handle instead (spoofing regression)', async () => {
    publicGetProfile.mockResolvedValue({
      data: { handle: 'real-owner.example', displayName: 'Real Owner', description: null, avatar: null },
    })
    const req = new Request('http://x/vidi/api/backlog', {
      method: 'POST',
      body: JSON.stringify({ orgId: 1, subjectDid: 'did:plc:victim', handle: 'attacker-controlled.example' }),
    })
    await POST(req as any)
    const accountsInsert = insertedValues.find((v) => 'handle' in v)
    expect(accountsInsert).toBeTruthy()
    expect(accountsInsert!.handle).toBe('real-owner.example')
    expect(accountsInsert!.handle).not.toBe('attacker-controlled.example')
  })
})
