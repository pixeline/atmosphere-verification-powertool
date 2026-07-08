import { describe, it, expect, vi, beforeEach } from 'vitest'

const createRecord = vi.fn()
const deleteRecord = vi.fn()
// getProfile on the ORG agent must never be used any more (see publicGetProfile below) —
// kept only to assert it stays untouched by the fallback path.
const getProfile = vi.fn()

vi.mock('../../src/lib/atproto/orgAgent', () => ({
  getOrgAgent: async () => ({ com: { atproto: { repo: { createRecord, deleteRecord } } }, getProfile }),
}))

// The identity-resolution fallback in verifyService now goes through an
// unauthenticated public AppView AtpAgent, not the org's OAuth-bound agent.
// Mock @atproto/api so we can assert THAT getProfile is what gets called.
const publicGetProfile = vi.fn()
vi.mock('@atproto/api', () => ({
  AtpAgent: class {
    constructor() {
      return { getProfile: publicGetProfile } as any
    }
  },
}))

const checkGuards = vi.fn()
vi.mock('../../src/lib/verify/guardrails', () => ({ checkGuards: (...args: unknown[]) => checkGuards(...args) }))

// Recording db mock: tracks every insert/select/delete call so tests can assert on real args.
const calls: { inserts: Array<{ table: unknown; values: unknown; conflict?: unknown }>; selects: Array<{ table: unknown; where: unknown }>; deletes: Array<{ table: unknown; where: unknown }> } = {
  inserts: [],
  selects: [],
  deletes: [],
}

// selectResult drives the accountVerifications lookup (used by revokeOne).
// accountsSelectResult drives the accounts lookup (used by verifyOne's
// server-side identity resolution) — kept separate so tests can control each
// table's mocked query result independently.
let selectResult: unknown[] = []
let accountsSelectResult: unknown[] = []
let shouldRejectAccountsUpsert = false

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
                if (shouldRejectAccountsUpsert && table === accounts) {
                  throw new Error('upsert failed')
                }
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
              return table === accounts ? accountsSelectResult : selectResult
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
import { accountVerifications, accounts } from '../../src/db/schema'

beforeEach(() => {
  createRecord.mockReset()
  deleteRecord.mockReset()
  getProfile.mockReset()
  publicGetProfile.mockReset()
  checkGuards.mockReset()
  calls.inserts = []
  calls.selects = []
  calls.deletes = []
  selectResult = []
  accountsSelectResult = []
  shouldRejectAccountsUpsert = false
})

function auditInserts() {
  return calls.inserts.filter((c) => c.values && Object.prototype.hasOwnProperty.call(c.values as object, 'action'))
}

describe('verifyOne', () => {
  it('skips duplicates without writing a record', async () => {
    checkGuards.mockResolvedValue({ ok: false, reason: 'duplicate' })
    const res = await verifyOne({ org: { id: 1, did: 'did:plc:org' }, actorDid: 'did:plc:a', subject: { did: 'did:plc:s' } })
    expect(res.outcome).toBe('skipped-duplicate')
    expect(createRecord).not.toHaveBeenCalled()
  })

  it('writes the verification record as the org using the SERVER-resolved handle (ignoring any spoofed client handle), upserts, and audits the member as actor', async () => {
    checkGuards.mockResolvedValue({ ok: true })
    createRecord.mockResolvedValue({ data: { uri: 'at://did:plc:org/app.bsky.graph.verification/rk1', cid: 'x' } })
    // Our indexed accounts table is the authority: it has the REAL handle.
    accountsSelectResult = [{ did: 'did:plc:sub', handle: 'real.example', displayName: 'Real Name' }]

    const res = await verifyOne({
      org: { id: 1, did: 'did:plc:org' },
      actorDid: 'did:plc:member',
      // Only `did` is part of the trusted contract now; TS structurally allows
      // extra fields on a plain object literal, so this also documents that
      // even if a caller smuggles a spoofed handle/displayName through, they
      // are never read.
      subject: { did: 'did:plc:sub', handle: 'spoofed-handle.evil', displayName: 'Spoofed Name' } as unknown as { did: string },
    })

    expect(res.outcome).toBe('verified')

    // accounts table was consulted for server-side identity resolution.
    const accountsSelect = calls.selects.find((c) => c.table === accounts)
    expect(accountsSelect).toBeTruthy()
    // getProfile fallback must NOT be used when accounts has a row (neither
    // the org agent's nor the public AppView agent's).
    expect(getProfile).not.toHaveBeenCalled()
    expect(publicGetProfile).not.toHaveBeenCalled()

    // Write happens as the org, not the actor.
    expect(createRecord).toHaveBeenCalledTimes(1)
    const createArgs = createRecord.mock.calls[0][0]
    expect(createArgs.repo).toBe('did:plc:org')
    expect(createArgs.collection).toBe('app.bsky.graph.verification')
    expect(createArgs.record.subject).toBe('did:plc:sub')
    // The record must use the SERVER-resolved (indexed) handle/displayName,
    // never the spoofed client-supplied values.
    expect(createArgs.record.handle).toBe('real.example')
    expect(createArgs.record.displayName).toBe('Real Name')
    expect(createArgs.record.handle).not.toBe('spoofed-handle.evil')

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

  it('falls back to the PUBLIC AppView agent getProfile for the handle/displayName when the subject is not in the local accounts index', async () => {
    checkGuards.mockResolvedValue({ ok: true })
    createRecord.mockResolvedValue({ data: { uri: 'at://did:plc:org/app.bsky.graph.verification/rk2', cid: 'y' } })
    accountsSelectResult = [] // not indexed locally
    publicGetProfile.mockResolvedValue({ data: { handle: 'fromprofile.example', displayName: 'From Profile' } })

    const res = await verifyOne({
      org: { id: 1, did: 'did:plc:org' },
      actorDid: 'did:plc:member',
      subject: { did: 'did:plc:sub2' },
    })

    expect(res.outcome).toBe('verified')
    // The PUBLIC AppView agent's getProfile is used, never the org agent's.
    expect(publicGetProfile).toHaveBeenCalledTimes(1)
    expect(publicGetProfile).toHaveBeenCalledWith({ actor: 'did:plc:sub2' })
    expect(getProfile).not.toHaveBeenCalled()

    const createArgs = createRecord.mock.calls[0][0]
    expect(createArgs.record.handle).toBe('fromprofile.example')
    expect(createArgs.record.displayName).toBe('From Profile')
  })

  it('copies followersCount/followsCount from the live profile into the upserted accounts row', async () => {
    accountsSelectResult = []
    checkGuards.mockResolvedValue({ ok: true })
    publicGetProfile.mockResolvedValue({
      data: { handle: 'newfound.brussels', displayName: 'New', followersCount: 15, followsCount: 3 },
    })
    createRecord.mockResolvedValue({ data: { uri: 'at://did:plc:org/app.bsky.graph.verification/rk1', cid: 'x' } })

    await verifyOne({ org: { id: 1, did: 'did:plc:org' }, actorDid: 'did:plc:member', subject: { did: 'did:plc:newfound2' } })

    const accountsInsert = calls.inserts.find((i) => (i.values as any)?.did === 'did:plc:newfound2')
    expect(accountsInsert).toBeTruthy()
    expect((accountsInsert!.values as any).followersCount).toBe(15)
    expect((accountsInsert!.values as any).followsCount).toBe(3)
  })

  it('upserts an accounts row when identity resolution falls back to the live profile', async () => {
    accountsSelectResult = [] // not indexed yet
    checkGuards.mockResolvedValue({ ok: true })
    publicGetProfile.mockResolvedValue({
      data: { handle: 'newfound.brussels', displayName: 'New Account', description: 'a bio', avatar: null },
    })
    createRecord.mockResolvedValue({ data: { uri: 'at://did:plc:org/app.bsky.graph.verification/rk1', cid: 'x' } })

    await verifyOne({ org: { id: 1, did: 'did:plc:org' }, actorDid: 'did:plc:member', subject: { did: 'did:plc:newfound' } })

    const accountsInsert = calls.inserts.find((i) => (i.values as any)?.did === 'did:plc:newfound')
    expect(accountsInsert).toBeTruthy()
    expect((accountsInsert!.values as any).handle).toBe('newfound.brussels')
    expect((accountsInsert!.values as any).seedSource).toBe('verify-fallback')
  })

  it('still completes verification successfully when the accounts upsert fails', async () => {
    accountsSelectResult = [] // not indexed yet
    shouldRejectAccountsUpsert = true // make the upsert throw
    checkGuards.mockResolvedValue({ ok: true })
    publicGetProfile.mockResolvedValue({
      data: { handle: 'failed-upsert.example', displayName: 'Failed Upsert', description: 'bio', avatar: null },
    })
    createRecord.mockResolvedValue({ data: { uri: 'at://did:plc:org/app.bsky.graph.verification/rk1', cid: 'x' } })

    // Despite the upsert throwing, verifyOne should still succeed
    const res = await verifyOne({
      org: { id: 1, did: 'did:plc:org' },
      actorDid: 'did:plc:member',
      subject: { did: 'did:plc:failed' },
    })

    expect(res.outcome).toBe('verified')
    // createRecord should have been called (the on-chain verification still happened)
    expect(createRecord).toHaveBeenCalledTimes(1)
    const createArgs = createRecord.mock.calls[0][0]
    expect(createArgs.record.handle).toBe('failed-upsert.example')
    expect(createArgs.record.displayName).toBe('Failed Upsert')
  })

  it('returns outcome error and audits without rethrowing when createRecord throws', async () => {
    checkGuards.mockResolvedValue({ ok: true })
    createRecord.mockRejectedValue(new Error('pds down'))
    accountsSelectResult = [{ did: 'did:plc:sub', handle: 'sub.example', displayName: 'Sub' }]

    const res = await verifyOne({
      org: { id: 1, did: 'did:plc:org' },
      actorDid: 'did:plc:member',
      subject: { did: 'did:plc:sub' },
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
