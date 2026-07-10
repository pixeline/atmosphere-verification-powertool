import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'

vi.mock('@/lib/hooks/useOrg', () => ({ useOrg: () => ({ orgId: 1 }) }))

// SearchForm has its own dedicated test suite; stub it here so this test can
// drive `results` without re-exercising the real form/typeahead.
vi.mock('@/components/SearchForm', () => ({
  SearchForm: ({ onSearch }: { onSearch: (f: unknown) => void }) => (
    <button onClick={() => onSearch({})}>run-search</button>
  ),
}))

const notifyVerifiedCountChanged = vi.fn()
vi.mock('@/lib/verifiedCountBus', () => ({
  notifyVerifiedCountChanged: () => notifyVerifiedCountChanged(),
}))

const toastError = vi.fn()
const toastSuccess = vi.fn()
vi.mock('sonner', () => ({ toast: { error: (...a: unknown[]) => toastError(...a), success: (...a: unknown[]) => toastSuccess(...a) } }))

import SearchPage from '../../src/app/(app)/search/page'

afterEach(cleanup)
beforeEach(() => {
  notifyVerifiedCountChanged.mockClear()
  toastError.mockClear()
  toastSuccess.mockClear()
})

function mockFetchSequence(verifyOk: boolean) {
  global.fetch = vi.fn((url: string) => {
    if (String(url).includes('/trusted-verifiers')) {
      return Promise.resolve({ json: async () => ({ verifiers: [] }) }) as any
    }
    if (String(url).includes('/api/search')) {
      return Promise.resolve({
        ok: true,
        json: async () => ({ results: [{ did: 'did:plc:x', handle: 'x.bsky.social' }] }),
      }) as any
    }
    if (String(url).includes('/api/verify')) {
      return Promise.resolve({ ok: verifyOk, json: async () => ({}) }) as any
    }
    return Promise.resolve({ ok: true, json: async () => ({}) }) as any
  }) as any
}

async function runSearchAndSelectOne() {
  fireEvent.click(screen.getByText('run-search'))
  await waitFor(() => screen.getByText(/1 account/i))
  fireEvent.click(screen.getByRole('checkbox'))
}

describe('SearchPage verify()', () => {
  it('notifies the verified-count bus after a successful verify', async () => {
    mockFetchSequence(true)
    render(<SearchPage />)
    await runSearchAndSelectOne()

    fireEvent.click(screen.getByRole('button', { name: /verify selected/i }))

    await waitFor(() => expect(toastSuccess).toHaveBeenCalledTimes(1))
    expect(notifyVerifiedCountChanged).toHaveBeenCalledTimes(1)
  })

  it('does not notify the bus when verify fails', async () => {
    mockFetchSequence(false)
    render(<SearchPage />)
    await runSearchAndSelectOne()

    fireEvent.click(screen.getByRole('button', { name: /verify selected/i }))

    await waitFor(() => expect(toastError).toHaveBeenCalledTimes(1))
    expect(notifyVerifiedCountChanged).not.toHaveBeenCalled()
  })
})
