import { describe, it, expect, vi, beforeEach } from 'vitest'

const getActor = vi.fn()
const isAllowlisted = vi.fn()

vi.mock('../../src/lib/authz/session', () => ({ getActor: () => getActor() }))
vi.mock('../../src/lib/allowlist', () => ({ isAllowlisted: (did: string) => isAllowlisted(did) }))

// Distinguish the members select from the orgs select by a sentinel field on
// the mocked table object passed to `.from()`.
vi.mock('../../src/db/schema', () => ({
  members: { __t: 'members' } as any,
  orgs: { __t: 'orgs' } as any,
}))

const rowsHolder = vi.hoisted(() => ({ memberRows: [] as any[], orgRows: [] as any[] }))
vi.mock('../../src/db/client', () => ({
  db: {
    select: () => ({
      from: (table: any) => ({
        where: async () => (table?.__t === 'orgs' ? rowsHolder.orgRows : rowsHolder.memberRows),
      }),
    }),
  },
}))

import { GET } from '../../src/app/api/org/context/route'

describe('GET /api/org/context', () => {
  beforeEach(() => {
    getActor.mockReset()
    isAllowlisted.mockReset()
    rowsHolder.memberRows = []
    rowsHolder.orgRows = []
  })

  it('returns 401 with orgId null when unauthenticated', async () => {
    getActor.mockResolvedValue(null)
    const res = await GET()
    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ orgId: null })
  })

  it('returns org handle + isAllowlisted for an owner', async () => {
    getActor.mockResolvedValue({ did: 'did:plc:org' })
    isAllowlisted.mockResolvedValue(true)
    rowsHolder.memberRows = [{ orgId: 7, role: 'owner', status: 'active', handle: 'stale.owner' }]
    rowsHolder.orgRows = [{ id: 7, handle: 'org.example.com' }]

    const res = await GET()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      orgId: 7,
      role: 'owner',
      isAllowlisted: true,
      handle: 'org.example.com',
    })
  })

  it('returns the membership handle for a helper', async () => {
    getActor.mockResolvedValue({ did: 'did:plc:helper' })
    isAllowlisted.mockResolvedValue(false)
    rowsHolder.memberRows = [{ orgId: 7, role: 'helper', status: 'active', handle: 'pixeline.be' }]

    const res = await GET()
    expect(await res.json()).toEqual({
      orgId: 7,
      role: 'helper',
      isAllowlisted: false,
      handle: 'pixeline.be',
    })
  })

  it('returns null orgId/role/handle for an actor with no membership', async () => {
    getActor.mockResolvedValue({ did: 'did:plc:nobody' })
    isAllowlisted.mockResolvedValue(false)
    rowsHolder.memberRows = []

    const res = await GET()
    expect(await res.json()).toEqual({
      orgId: null,
      role: null,
      isAllowlisted: false,
      handle: null,
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
