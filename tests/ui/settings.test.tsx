import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { SettingsView } from '../../src/app/(app)/settings/page'

const toastError = vi.fn()
vi.mock('sonner', () => ({ toast: { error: (...a: unknown[]) => toastError(...a), success: vi.fn() } }))

describe('SettingsView', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    cleanup()
  })

  it('shows nothing for a helper role', () => {
    render(<SettingsView role="helper" orgId={1} seeds={[]} />)
    expect(screen.queryByText(/crawl keywords/i)).toBeNull()
  })

  it('shows the keyword list and add form for an owner', () => {
    render(
      <SettingsView
        role="owner"
        orgId={1}
        seeds={[{ id: 1, keyword: 'brussels', enabled: true }]}
      />
    )
    expect(screen.getByText(/crawl keywords/i)).toBeTruthy()
    expect(screen.getByText('brussels')).toBeTruthy()
    expect(screen.getByRole('button', { name: /add/i })).toBeTruthy()
    expect(screen.getByRole('button', { name: /run crawl now/i })).toBeTruthy()
  })

  it('does not add keyword when fetch returns not ok', async () => {
    global.fetch = vi.fn(() =>
      Promise.resolve({
        ok: false,
        json: () => Promise.resolve({}),
      } as Response)
    )

    render(<SettingsView role="owner" orgId={1} seeds={[]} />)

    const input = screen.getByRole('textbox', { name: /add keyword/i }) as HTMLInputElement
    const addButtons = screen.getAllByRole('button', { name: /add/i })
    const addButton = addButtons[0]

    fireEvent.change(input, { target: { value: 'test-keyword' } })
    fireEvent.click(addButton)

    await waitFor(() => {
      expect(screen.queryByText('test-keyword')).toBeNull()
      expect(input.value).toBe('test-keyword')
    })
  })

  it('picks up seeds that arrive after the initial mount (parent fetch resolving late)', () => {
    // SettingsPage renders SettingsView as soon as org context resolves, but
    // its own crawl-seeds fetch is still in flight at that point — so
    // SettingsView always mounts with seeds=[] first, then receives the real
    // list a moment later via a prop update, not at initial mount.
    const { rerender } = render(<SettingsView role="owner" orgId={1} seeds={[]} />)
    expect(screen.queryByText('brussels')).toBeNull()

    rerender(
      <SettingsView
        role="owner"
        orgId={1}
        seeds={[{ id: 1, keyword: 'brussels', enabled: true }]}
      />
    )

    expect(screen.getByText('brussels')).toBeTruthy()
  })
})

describe('SettingsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    cleanup()
  })

  it('surfaces an error toast instead of silently showing an empty list when the crawl-seeds fetch fails', async () => {
    vi.doMock('@/lib/hooks/useOrg', () => ({
      useOrg: () => ({ orgId: 1, role: 'owner', loading: false }),
    }))
    global.fetch = vi.fn(() => Promise.resolve({ ok: false, json: () => Promise.resolve({}) } as Response))

    const { default: SettingsPage } = await import('../../src/app/(app)/settings/page')
    render(<SettingsPage />)

    await waitFor(() => expect(toastError).toHaveBeenCalledTimes(1))
  })
})
