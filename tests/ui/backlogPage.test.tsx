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
    // Cards are selectable for bulk Verify/Skip selected.
    expect(screen.getByRole('checkbox')).toBeTruthy()
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

  it('sorts by Belgian evidence and verifies the strong selection in one batch, settling statuses in bulk', async () => {
    const items = [
      { subjectDid: 'did:plc:weak', note: null, handle: 'weak.bsky.social', displayName: 'Weak', description: 'cat pics', verifiers: [] },
      { subjectDid: 'did:plc:strong', note: null, handle: 'strong.be', displayName: 'Strong', description: '🇧🇪 Gent', verifiers: [] },
      // Strong bio, but a broken handle: flagged and never bulk-selected.
      { subjectDid: 'did:plc:broken', note: null, handle: 'handle.invalid', displayName: 'Broken', description: '🇧🇪 Brussels', verifiers: [] },
    ]
    global.fetch = vi.fn((url: string, init?: any) => {
      if (String(url).includes('/api/verify')) {
        const { subjects } = JSON.parse(init.body)
        return Promise.resolve({ ok: true, json: async () => ({ results: subjects.map((s: any) => ({ did: s.did, outcome: 'verified' })) }) }) as any
      }
      if (init?.method === 'PATCH') return Promise.resolve({ ok: true, json: async () => ({}) }) as any
      return Promise.resolve({ ok: true, json: async () => ({ items }) }) as any
    }) as any
    render(<BacklogPage />)
    await waitFor(() => expect(screen.getByText('strong.be', { exact: false })).toBeTruthy())

    // Strongest evidence is listed first, with its signals as a badge.
    const handles = screen.getAllByText(/@\S+/).map((n) => n.textContent)
    expect(handles).toEqual(['@strong.be', '@handle.invalid', '@weak.bsky.social'])
    expect(screen.getByText(/BE 8/)).toBeTruthy()
    expect(screen.getByText('handle not resolving')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: /select strong/i }))
    fireEvent.click(screen.getByRole('button', { name: /verify selected/i }))

    await waitFor(() => expect(verifyCalls().length).toBe(1))
    expect(JSON.parse(verifyCalls()[0][1].body).subjects.map((s: any) => s.did)).toEqual(['did:plc:strong'])
    const patch = (global.fetch as any).mock.calls.find((c: any[]) => c[1]?.method === 'PATCH')
    expect(JSON.parse(patch[1].body)).toMatchObject({ subjectDids: ['did:plc:strong'], status: 'verified' })
    await waitFor(() => expect(screen.queryByText('strong.be', { exact: false })).toBeNull())
    expect(screen.getByText('weak.bsky.social', { exact: false })).toBeTruthy()
    expect(notifyMock).toHaveBeenCalledTimes(1)
  })

  it('imports the DIDs found in an uploaded TSV and reloads the backlog', async () => {
    mockFetch([])
    ;(global.fetch as any).mockImplementation((url: string) => {
      if (String(url).includes('/api/backlog/import')) {
        return Promise.resolve({ ok: true, json: async () => ({ queued: 1, alreadyVerified: 0, alreadyInBacklog: 0, notFound: 0, invalid: 0 }) })
      }
      return Promise.resolve({ ok: true, json: async () => ({ items: [] }) })
    })
    render(<BacklogPage />)
    const tsv = 'handle\tdid\ton_verifier_list\nrvloock.be\tdid:plc:22e257wwxrbho4emycurotpi\tno\n'
    const file = new File([tsv], 'list.tsv', { type: 'text/tab-separated-values' })
    fireEvent.change(screen.getByLabelText('Import list file'), { target: { files: [file] } })

    await waitFor(() => expect(toastSuccess).toHaveBeenCalled())
    const call = (global.fetch as any).mock.calls.find((c: any[]) => String(c[0]).includes('/api/backlog/import'))
    expect(JSON.parse(call[1].body)).toEqual({ orgId: 1, dids: ['did:plc:22e257wwxrbho4emycurotpi'] })
  })
})
