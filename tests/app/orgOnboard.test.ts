import { describe, it, expect, vi, beforeEach } from 'vitest'

const getActor = vi.fn()
const isAllowlisted = vi.fn()
const getOrgAgent = vi.fn()

vi.mock('../../src/lib/authz/session', () => ({ getActor: () => getActor() }))
vi.mock('../../src/lib/allowlist', () => ({ isAllowlisted: (did: string) => isAllowlisted(did) }))
vi.mock('../../src/lib/atproto/orgAgent', () => ({ getOrgAgent: (did: string) => getOrgAgent(did) }))

const returning = vi.fn()
const onConflictDoUpdateOrgs = vi.fn(() => ({ returning }))
const onConflictDoUpdateMembers = vi.fn(async () => undefined)
const valuesOrgs = vi.fn(() => ({ onConflictDoUpdate: onConflictDoUpdateOrgs }))
const valuesMembers = vi.fn(() => ({ onConflictDoUpdate: onConflictDoUpdateMembers }))
const insert = vi.fn((table: any) => ({
  values: table === 'orgs-table' ? valuesOrgs : valuesMembers,
}))

vi.mock('../../src/db/schema', () => ({ orgs: { did: 'orgs.did' } as any, members: { orgId: 'm.orgId', memberDid: 'm.memberDid' } as any }))
vi.mock('../../src/db/client', () => ({
  db: {
    insert: (table: any) => {
      // distinguish orgs vs members insert by identity of the mocked table object
      return table && table.did === 'orgs.did' ? { values: valuesOrgs } : { values: valuesMembers }
    },
  },
}))

import { POST } from '../../src/app/api/org/onboard/route'

describe('POST /api/org/onboard', () => {
  beforeEach(() => {
    getActor.mockReset()
    isAllowlisted.mockReset()
    getOrgAgent.mockReset()
    returning.mockReset()
    valuesOrgs.mockClear()
    valuesMembers.mockClear()
    onConflictDoUpdateOrgs.mockClear()
    onConflictDoUpdateMembers.mockClear()
  })

  it('returns 401 when unauthenticated', async () => {
    getActor.mockResolvedValue(null)
    const res = await POST()
    expect(res.status).toBe(401)
    expect((await res.json()).error).toBe('unauthenticated')
  })

  it('returns 403 when not allowlisted', async () => {
    getActor.mockResolvedValue({ did: 'did:plc:org' })
    isAllowlisted.mockResolvedValue(false)
    const res = await POST()
    expect(res.status).toBe(403)
    expect((await res.json()).error).toBe('not_allowlisted')
  })

  it('returns 400 no_org_session when the org OAuth session cannot be restored', async () => {
    getActor.mockResolvedValue({ did: 'did:plc:org' })
    isAllowlisted.mockResolvedValue(true)
    getOrgAgent.mockRejectedValue(new Error('no session'))
    const res = await POST()
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('no_org_session')
  })

  it('upserts org + owner member and returns ok + orgId', async () => {
    getActor.mockResolvedValue({ did: 'did:plc:org' })
    isAllowlisted.mockResolvedValue(true)
    getOrgAgent.mockResolvedValue({
      getProfile: async ({ actor }: { actor: string }) => ({ data: { handle: 'org.example.com', did: actor } }),
    })
    returning.mockResolvedValue([{ id: 42 }])

    const res = await POST()
    const body = await res.json()

    expect(body).toEqual({ ok: true, orgId: 42 })
    expect(valuesOrgs).toHaveBeenCalledWith(
      expect.objectContaining({
        did: 'did:plc:org',
        handle: 'org.example.com',
        status: 'active',
        scopes: 'atproto transition:generic',
        onboardedByDid: 'did:plc:org',
      })
    )
    expect(onConflictDoUpdateOrgs).toHaveBeenCalledWith(
      expect.objectContaining({ target: 'orgs.did', set: { handle: 'org.example.com', status: 'active' } })
    )
    expect(valuesMembers).toHaveBeenCalledWith(
      expect.objectContaining({ orgId: 42, memberDid: 'did:plc:org', handle: 'org.example.com', role: 'owner' })
    )
    expect(onConflictDoUpdateMembers).toHaveBeenCalledWith(
      expect.objectContaining({
        target: ['m.orgId', 'm.memberDid'],
        set: { role: 'owner', status: 'active' },
      })
    )
  })
})
