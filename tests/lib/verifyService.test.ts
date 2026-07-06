import { describe, it, expect, vi, beforeEach } from 'vitest'

const createRecord = vi.fn()
const deleteRecord = vi.fn()

vi.mock('../../src/lib/atproto/orgAgent', () => ({
  getOrgAgent: async () => ({ com: { atproto: { repo: { createRecord, deleteRecord } } } }),
}))

const checkGuards = vi.fn()
vi.mock('../../src/lib/verify/guardrails', () => ({ checkGuards: (...args: unknown[]) => checkGuards(...args) }))

// Recording db mock: tracks every insert/select/delete call so tests can assert on real args.
const calls: { inserts: Array<{ table: unknown; values: unknown; conflict?: unknown }>; selects: Array<{ table: unknown; where: unknown }>; deletes: Array<{ table: unknown; where: unknown }> } = {
  inserts: [],
  selects: [],
  deletes: [],
}

let selectResult: unknown[] = []

vi.mock('../../src/db/client', () => {
  return {
    db: {
      insert: (table: unknown) => {
        return {
          values: (values: unknown) => {
            const record: { table: unknown; values: unknown; conflict?: unknown } = { table, values }
            calls.inserts.push(record)
            return {
              onConflictDoUpdate: async (conflict: unknown) => {
                record.conflict = conflict
                return {}
              },
              // audit() awaits values(...) directly without chaining onConflictDoUpdate
              then: (resolve: (v: unknown) => void) => resolve({}),
            }
          },
        }
      },
      select: () => ({
        from: (table: unknown) => {
          return {
            where: async (where: unknown) => {
              calls.selects.push({ table, where })
              return selectResult
            },
          }
        },
      }),
      delete: (table: unknown) => {
        return {
          where: async (where: unknown) => {
            calls.deletes.push({ table, where })
            return {}
          },
        }
      },
    },
  }
})

import { verifyOne, revokeOne } from '../../src/lib/verify/verifyService'
import { accountVerifications } from '../../src/db/schema'

beforeEach(() => {
  createRecord.mockReset()
  deleteRecord.mockReset()
  checkGuards.mockReset()
  calls.inserts = []
  calls.selects = []
  calls.deletes = []
  selectResult = []
})

function auditInserts() {
  return calls.inserts.filter((c) => c.values && Object.prototype.hasOwnProperty.call(c.values as object, 'action'))
}

describe('verifyOne', () => {
  it('skips duplicates without writing a record', async () => {
    checkGuards.mockResolvedValue({ ok: false, reason: 'duplicate' })
    const res = await verifyOne({ org: { id: 1, did: 'did:plc:org' }, actorDid: 'did:plc:a', subject: { did: 'did:plc:s', handle: 's.bsky.social' } })
    expect(res.outcome).toBe('skipped-duplicate')
    expect(createRecord).not.toHaveBeenCalled()
  })

  it('writes the verification record as the org, upserts, and audits the member as actor', async () => {
    checkGuards.mockResolvedValue({ ok: true })
    createRecord.mockResolvedValue({ data: { uri: 'at://did:plc:org/app.bsky.graph.verification/rk1', cid: 'x' } })

    const res = await verifyOne({
      org: { id: 1, did: 'did:plc:org' },
      actorDid: 'did:plc:member',
      subject: { did: 'did:plc:sub', handle: 'sub.example', displayName: 'Sub' },
    })

    expect(res.outcome).toBe('verified')

    // Write happens as the org, not the actor.
    expect(createRecord).toHaveBeenCalledTimes(1)
    const createArgs = createRecord.mock.calls[0][0]
    expect(createArgs.repo).toBe('did:plc:org')
    expect(createArgs.collection).toBe('app.bsky.graph.verification')
    expect(createArgs.record.subject).toBe('did:plc:sub')

    // accountVerifications upsert ran.
    const upsertCall = calls.inserts.find((c) => c.table === accountVerifications)
    expect(upsertCall).toBeTruthy()
    expect(upsertCall!.conflict).toBeTruthy()
    expect((upsertCall!.values as { recordUri: string }).recordUri).toBe('at://did:plc:org/app.bsky.graph.verification/rk1')

    // Audit row records the MEMBER as actor, not the org.
    const audits = auditInserts()
    expect(audits).toHaveLength(1)
    const auditValues = audits[0].values as { actorDid: string; action: string; outcome: string; subjectDid: string }
    expect(auditValues.actorDid).toBe('did:plc:member')
    expect(auditValues.action).toBe('verify')
    expect(auditValues.outcome).toBe('verified')
    expect(auditValues.subjectDid).toBe('did:plc:sub')
  })

  it('returns outcome error and audits without rethrowing when createRecord throws', async () => {
    checkGuards.mockResolvedValue({ ok: true })
    createRecord.mockRejectedValue(new Error('pds down'))

    const res = await verifyOne({
      org: { id: 1, did: 'did:plc:org' },
      actorDid: 'did:plc:member',
      subject: { did: 'did:plc:sub', handle: 'sub.example', displayName: 'Sub' },
    })

    expect(res.outcome).toBe('error')

    const audits = auditInserts()
    expect(audits).toHaveLength(1)
    const auditValues = audits[0].values as { outcome: string; action: string }
    expect(auditValues.outcome).toBe('error')
    expect(auditValues.action).toBe('verify')
  })
})

describe('revokeOne', () => {
  it('deletes the record as the org, removes the row, and audits revoked', async () => {
    selectResult = [{ recordUri: 'at://did:plc:org/app.bsky.graph.verification/rk1' }]

    const res = await revokeOne({ org: { id: 1, did: 'did:plc:org' }, actorDid: 'did:plc:member', subjectDid: 'did:plc:sub' })

    expect(res.outcome).toBe('revoked')

    expect(deleteRecord).toHaveBeenCalledTimes(1)
    const deleteArgs = deleteRecord.mock.calls[0][0]
    expect(deleteArgs.repo).toBe('did:plc:org')
    expect(deleteArgs.collection).toBe('app.bsky.graph.verification')
    expect(deleteArgs.rkey).toBe('rk1')

    expect(calls.deletes).toHaveLength(1)
    expect(calls.deletes[0].table).toBe(accountVerifications)

    const audits = auditInserts()
    expect(audits).toHaveLength(1)
    const auditValues = audits[0].values as { outcome: string; action: string; actorDid: string }
    expect(auditValues.outcome).toBe('revoked')
    expect(auditValues.action).toBe('revoke')
    expect(auditValues.actorDid).toBe('did:plc:member')
  })

  it('audits an error outcome when there is no matching verification row', async () => {
    selectResult = []

    const res = await revokeOne({ org: { id: 1, did: 'did:plc:org' }, actorDid: 'did:plc:member', subjectDid: 'did:plc:sub' })

    expect(res.outcome).toBe('error')
    expect(deleteRecord).not.toHaveBeenCalled()
    expect(calls.deletes).toHaveLength(0)

    const audits = auditInserts()
    expect(audits).toHaveLength(1)
    const auditValues = audits[0].values as { outcome: string; action: string }
    expect(auditValues.outcome).toBe('error')
    expect(auditValues.action).toBe('revoke')
  })
})
