import { describe, it, expect, vi, beforeEach } from 'vitest'

const resolveMock = vi.fn()
vi.mock('@atproto/identity', () => ({
  IdResolver: class {
    did = { resolveAtprotoData: (did: string) => resolveMock(did) }
  },
}))

const listRecordsMock = vi.fn()
vi.mock('@atproto/api', () => ({
  AtpAgent: class {
    com = { atproto: { repo: { listRecords: (args: unknown) => listRecordsMock(args) } } }
    constructor(_opts: unknown) {}
  },
}))

import { countOrgVerifications, invalidateOrgVerificationCount } from '../../src/lib/verify/verifiedCount'

beforeEach(() => {
  resolveMock.mockReset()
  listRecordsMock.mockReset()
  resolveMock.mockResolvedValue({ pds: 'https://pds.example' })
})

function page(n: number, cursor?: string) {
  return { data: { records: Array.from({ length: n }, (_, i) => ({ uri: `r${i}` })), cursor } }
}

describe('countOrgVerifications', () => {
  it('paginates listRecords and returns the total record count', async () => {
    listRecordsMock.mockResolvedValueOnce(page(100, 'c1')).mockResolvedValueOnce(page(16))
    const n = await countOrgVerifications('did:plc:a', 1000)
    expect(n).toBe(116)
    expect(listRecordsMock).toHaveBeenCalledTimes(2)
  })

  it('serves a cached value within the TTL without re-fetching', async () => {
    listRecordsMock.mockResolvedValueOnce(page(5))
    await countOrgVerifications('did:plc:b', 1000)
    listRecordsMock.mockClear()
    const n = await countOrgVerifications('did:plc:b', 1000 + 60_000) // 1 min later, within the 5-min TTL
    expect(n).toBe(5)
    expect(listRecordsMock).not.toHaveBeenCalled()
  })

  it('recomputes once the TTL has expired', async () => {
    listRecordsMock.mockResolvedValueOnce(page(5)).mockResolvedValueOnce(page(9))
    await countOrgVerifications('did:plc:c', 1000)
    const n = await countOrgVerifications('did:plc:c', 1000 + 6 * 60_000) // past the 5-min TTL
    expect(n).toBe(9)
    expect(listRecordsMock).toHaveBeenCalledTimes(2)
  })

  it('recomputes immediately after invalidation, even within the TTL', async () => {
    listRecordsMock.mockResolvedValueOnce(page(5)).mockResolvedValueOnce(page(7))
    await countOrgVerifications('did:plc:d', 1000)
    invalidateOrgVerificationCount('did:plc:d')
    const n = await countOrgVerifications('did:plc:d', 1000 + 1000)
    expect(n).toBe(7)
    expect(listRecordsMock).toHaveBeenCalledTimes(2)
  })
})
