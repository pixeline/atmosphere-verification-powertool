import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'

vi.mock('@/lib/hooks/useOrg', () => ({ useOrg: () => ({ orgId: 1 }) }))

const toastError = vi.fn()
const toastSuccess = vi.fn()
vi.mock('sonner', () => ({ toast: { error: (...a: unknown[]) => toastError(...a), success: (...a: unknown[]) => toastSuccess(...a) } }))

const notifyMock = vi.fn()
vi.mock('@/lib/verifiedCountBus', () => ({ notifyVerifiedCountChanged: () => notifyMock() }))

import BacklogPage from '../../src/app/(app)/backlog/page'

afterEach(cleanup)
beforeEach(() => {
  toastError.mockClear()
  toastSuccess.mockClear()
  notifyMock.mockClear()
})

function mockFetch(items: unknown[], opts: { verifyOutcome?: string; patchOk?: boolean } = {}) {
  const { verifyOutcome = 'verified', patchOk = true } = opts
  global.fetch = vi.fn((url: string, init?: any) => {
    if (String(url).includes('/api/verify')) {
      return Promise.resolve({ ok: true, json: async () => ({ results: [{ did: 'did:plc:queued', outcome: verifyOutcome }] }) }) as any
    }
    if (init?.method === 'PATCH') {
      return Promise.resolve({ ok: patchOk, json: async () => ({}) }) as any
    }
    return Promise.resolve({ ok: true, json: async () => ({ items }) }) as any
  }) as any
}

function verifyCalls() {
  return (global.fetch as any).mock.calls.filter((c: any[]) => String(c[0]).includes('/api/verify'))
}

describe('BacklogPage', () => {
  it('renders each item as an AccountCard with handle and Mark verified/Skip actions', async () => {
    mockFetch([
      { subjectDid: 'did:plc:queued', note: 'check', handle: 'queued.example', displayName: 'Queued', verifiers: [] },
    ])
    render(<BacklogPage />)

    await waitFor(() => expect(screen.getByText('queued.example', { exact: false })).toBeTruthy())
    expect(screen.getByRole('button', { name: /mark verified/i })).toBeTruthy()
    expect(screen.getByRole('button', { name: /^skip$/i })).toBeTruthy()
    // AccountCard's own selection checkbox must NOT appear on Backlog cards.
    expect(screen.queryByRole('checkbox')).toBeNull()
  })

  it('actually verifies via /api/verify, refreshes the count, and removes the card on Mark verified', async () => {
    mockFetch([{ subjectDid: 'did:plc:queued', note: null, handle: 'queued.example', displayName: 'Queued User', verifiers: [] }])
    render(<BacklogPage />)
    await waitFor(() => expect(screen.getByText('queued.example', { exact: false })).toBeTruthy())

    fireEvent.click(screen.getByRole('button', { name: /mark verified/i }))

    // The core fix: Mark verified must hit the verify service (not just flip a
    // backlog status), then notify the count bus so the header updates.
    await waitFor(() => expect(verifyCalls().length).toBe(1))
    expect(JSON.parse(verifyCalls()[0][1].body)).toMatchObject({
      orgId: 1,
      subjects: [{ did: 'did:plc:queued' }],
    })
    await waitFor(() => expect(notifyMock).toHaveBeenCalledTimes(1))
    expect(toastSuccess).toHaveBeenCalledTimes(1)
    expect(screen.queryByText('queued.example', { exact: false })).toBeNull()
  })

  it('surfaces an error and keeps the card when the verify service reports an error outcome', async () => {
    mockFetch([{ subjectDid: 'did:plc:queued', note: null, handle: 'queued.example', displayName: 'Queued User', verifiers: [] }], { verifyOutcome: 'error' })
    render(<BacklogPage />)
    await waitFor(() => expect(screen.getByText('queued.example', { exact: false })).toBeTruthy())

    fireEvent.click(screen.getByRole('button', { name: /mark verified/i }))

    await waitFor(() => expect(toastError).toHaveBeenCalledTimes(1))
    expect(notifyMock).not.toHaveBeenCalled()
    expect(screen.getByText('queued.example', { exact: false })).toBeTruthy()
  })

  it('Skip only updates the backlog status and never calls the verify service', async () => {
    mockFetch([{ subjectDid: 'did:plc:queued', note: null, handle: 'queued.example', displayName: 'Queued User', verifiers: [] }])
    render(<BacklogPage />)
    await waitFor(() => expect(screen.getByText('queued.example', { exact: false })).toBeTruthy())

    fireEvent.click(screen.getByRole('button', { name: /^skip$/i }))

    await waitFor(() => expect(toastSuccess).toHaveBeenCalledTimes(1))
    expect(verifyCalls().length).toBe(0)
    expect(notifyMock).not.toHaveBeenCalled()
    expect(screen.queryByText('queued.example', { exact: false })).toBeNull()
  })
})
