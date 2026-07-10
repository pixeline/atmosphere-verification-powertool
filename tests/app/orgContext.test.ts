import { describe, it, expect, vi, beforeEach } from 'vitest'

const getActor = vi.fn()
const isAllowlisted = vi.fn()
const countOrgVerifications = vi.fn()

vi.mock('../../src/lib/authz/session', () => ({ getActor: () => getActor() }))
vi.mock('../../src/lib/allowlist', () => ({ isAllowlisted: (did: string) => isAllowlisted(did) }))
vi.mock('../../src/lib/verify/verifiedCount', () => ({ countOrgVerifications: (did: string) => countOrgVerifications(did) }))

// Distinguish the members select from the orgs/accountVerifications selects
// by a sentinel field on the mocked table object passed to `.from()`.
vi.mock('../../src/db/schema', () => ({
  members: { __t: 'members' } as any,
  orgs: { __t: 'orgs' } as any,
  accountVerifications: { __t: 'accountVerifications' } as any,
}))

const rowsHolder = vi.hoisted(() => ({
  memberRows: [] as any[],
  orgRows: [] as any[],
  verificationCountRows: [] as any[],
}))
vi.mock('../../src/db/client', () => ({
  db: {
    select: () => ({
      from: (table: any) => ({
        where: async () => {
          if (table?.__t === 'orgs') return rowsHolder.orgRows
          if (table?.__t === 'accountVerifications') return rowsHolder.verificationCountRows
          return rowsHolder.memberRows
        },
      }),
    }),
  },
}))

import { GET } from '../../src/app/api/org/context/route'

describe('GET /api/org/context', () => {
  beforeEach(() => {
    getActor.mockReset()
    isAllowlisted.mockReset()
    countOrgVerifications.mockReset()
    rowsHolder.memberRows = []
    rowsHolder.orgRows = []
    rowsHolder.verificationCountRows = []
  })

  it('returns 401 with orgId null when unauthenticated', async () => {
    getActor.mockResolvedValue(null)
    const res = await GET()
    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ orgId: null })
  })

  it('returns org handle + isAllowlisted + live verifiedCount for an owner', async () => {
    getActor.mockResolvedValue({ did: 'did:plc:org' })
    isAllowlisted.mockResolvedValue(true)
    countOrgVerifications.mockResolvedValue(42)
    rowsHolder.memberRows = [{ orgId: 7, role: 'owner', status: 'active', handle: 'stale.owner' }]
    rowsHolder.orgRows = [{ id: 7, did: 'did:plc:org', handle: 'org.example.com' }]

    const res = await GET()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      orgId: 7,
      role: 'owner',
      isAllowlisted: true,
      handle: 'org.example.com',
      verifiedCount: 42,
    })
    expect(countOrgVerifications).toHaveBeenCalledWith('did:plc:org')
  })

  it('returns the membership handle and live verifiedCount for a helper (scoped to the org, not the role)', async () => {
    getActor.mockResolvedValue({ did: 'did:plc:helper' })
    isAllowlisted.mockResolvedValue(false)
    countOrgVerifications.mockResolvedValue(5)
    rowsHolder.memberRows = [{ orgId: 7, role: 'helper', status: 'active', handle: 'pixeline.be' }]
    rowsHolder.orgRows = [{ id: 7, did: 'did:plc:org', handle: 'org.example.com' }]

    const res = await GET()
    expect(await res.json()).toEqual({
      orgId: 7,
      role: 'helper',
      isAllowlisted: false,
      handle: 'pixeline.be',
      verifiedCount: 5,
    })
  })

  it('falls back to the locally-crawled count when the live network read fails', async () => {
    getActor.mockResolvedValue({ did: 'did:plc:org' })
    isAllowlisted.mockResolvedValue(true)
    countOrgVerifications.mockRejectedValue(new Error('network down'))
    rowsHolder.memberRows = [{ orgId: 7, role: 'owner', status: 'active', handle: 'org.example.com' }]
    rowsHolder.orgRows = [{ id: 7, did: 'did:plc:org', handle: 'org.example.com' }]
    rowsHolder.verificationCountRows = [{ value: 400 }]

    const res = await GET()
    const body = await res.json()
    expect(body.verifiedCount).toBe(400)
  })

  it('returns null orgId/role/handle/verifiedCount for an actor with no membership', async () => {
    getActor.mockResolvedValue({ did: 'did:plc:nobody' })
    isAllowlisted.mockResolvedValue(false)
    rowsHolder.memberRows = []

    const res = await GET()
    expect(await res.json()).toEqual({
      orgId: null,
      role: null,
      isAllowlisted: false,
      handle: null,
      verifiedCount: null,
    })
  })

  it('surfaces isAllowlisted true for an allowlisted actor with no membership (can self-onboard)', async () => {
    getActor.mockResolvedValue({ did: 'did:plc:eligible' })
    isAllowlisted.mockResolvedValue(true)
    rowsHolder.memberRows = []

    const res = await GET()
    const body = await res.json()
    expect(body.orgId).toBeNull()
    expect(body.isAllowlisted).toBe(true)
  })
})
