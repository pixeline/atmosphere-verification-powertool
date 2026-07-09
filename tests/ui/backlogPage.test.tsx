import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'

vi.mock('@/lib/hooks/useOrg', () => ({ useOrg: () => ({ orgId: 1 }) }))

const toastError = vi.fn()
const toastSuccess = vi.fn()
vi.mock('sonner', () => ({ toast: { error: (...a: unknown[]) => toastError(...a), success: (...a: unknown[]) => toastSuccess(...a) } }))

import BacklogPage from '../../src/app/(app)/backlog/page'

afterEach(cleanup)
beforeEach(() => {
  toastError.mockClear()
  toastSuccess.mockClear()
})

function mockFetch(items: unknown[], patchOk = true) {
  global.fetch = vi.fn((url: string, init?: any) => {
    if (init?.method === 'PATCH') {
      return Promise.resolve({ ok: patchOk, json: async () => ({}) }) as any
    }
    return Promise.resolve({ ok: true, json: async () => ({ items }) }) as any
  }) as any
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

  it('removes the card and shows a success toast after marking verified', async () => {
    mockFetch([{ subjectDid: 'did:plc:queued', note: null, handle: 'queued.example', displayName: 'Queued User', verifiers: [] }])
    render(<BacklogPage />)
    await waitFor(() => expect(screen.getByText('queued.example', { exact: false })).toBeTruthy())

    fireEvent.click(screen.getByRole('button', { name: /mark verified/i }))

    await waitFor(() => expect(toastSuccess).toHaveBeenCalledTimes(1))
    expect(screen.queryByText('queued.example', { exact: false })).toBeNull()
  })
})
