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

  it('shows the keyword controls to a helper but hides Run crawl now', () => {
    render(<SettingsView role="helper" orgId={1} seeds={[{ id: 1, keyword: 'brussels', enabled: true }]} accountsCount={0} />)
    // Keyword management is open to members…
    expect(screen.getByText(/crawl keywords/i)).toBeTruthy()
    expect(screen.getByText('brussels')).toBeTruthy()
    expect(screen.getByRole('textbox', { name: /add keyword/i })).toBeTruthy()
    // …but running a crawl stays owner-only.
    expect(screen.queryByRole('button', { name: /run crawl now/i })).toBeNull()
  })

  it('shows the keyword list, add form, and Run crawl now for an owner', () => {
    render(
      <SettingsView
        role="owner"
        orgId={1}
        seeds={[{ id: 1, keyword: 'brussels', enabled: true }]}
        accountsCount={0}
      />
    )
    expect(screen.getByText(/crawl keywords/i)).toBeTruthy()
    expect(screen.getByText('brussels')).toBeTruthy()
    expect(screen.getByRole('button', { name: /^add$/i })).toBeTruthy()
    expect(screen.getByRole('button', { name: /run crawl now/i })).toBeTruthy()
  })

  it('shows the harvested-accounts count in the keywords description', () => {
    render(<SettingsView role="helper" orgId={1} seeds={[]} accountsCount={42} />)
    expect(screen.getByText('42')).toBeTruthy()
    expect(screen.getByText(/accounts harvested so far/i)).toBeTruthy()
  })

  it('does not add keyword when fetch returns not ok', async () => {
    global.fetch = vi.fn(() =>
      Promise.resolve({
        ok: false,
        json: () => Promise.resolve({}),
      } as Response)
    )

    render(<SettingsView role="owner" orgId={1} seeds={[]} accountsCount={null} />)

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

  it('renders the add-keyword form above the keyword list', () => {
    render(
      <SettingsView
        role="owner"
        orgId={1}
        seeds={[{ id: 1, keyword: 'brussels', enabled: true }]}
        accountsCount={0}
      />
    )
    const input = screen.getByRole('textbox', { name: /add keyword/i })
    const chip = screen.getByRole('button', { name: /brussels/i })
    // compareDocumentPosition bit 4 (DOCUMENT_POSITION_FOLLOWING) means `chip`
    // comes after `input` in the DOM.
    expect(input.compareDocumentPosition(chip) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('submits the new keyword when Enter is pressed in the input, not just by clicking Add', async () => {
    const fetchMock = vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({}) } as Response))
    global.fetch = fetchMock
    render(<SettingsView role="owner" orgId={1} seeds={[]} accountsCount={0} />)

    const input = screen.getByRole('textbox', { name: /add keyword/i })
    fireEvent.change(input, { target: { value: 'newkw' } })
    // The input lives inside a real <form>, so pressing Enter natively submits
    // it — fireEvent.submit is how that native behavior is exercised in jsdom.
    fireEvent.submit(input.closest('form')!)

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        '/vidi/api/crawl-seeds',
        expect.objectContaining({ method: 'POST' })
      )
    )
  })

  it('splits a pasted comma/space list into one chip per city and posts them as a keywords array', async () => {
    const fetchMock = vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({}) } as Response))
    global.fetch = fetchMock
    render(<SettingsView role="owner" orgId={1} seeds={[]} accountsCount={0} />)

    const input = screen.getByRole('textbox', { name: /add keyword/i }) as HTMLInputElement
    fireEvent.change(input, {
      target: { value: 'Brussels, Antwerp, Ghent, Charleroi, Liège, Schaerbeek, Anderlecht, Bruges' },
    })
    fireEvent.submit(input.closest('form')!)

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        '/vidi/api/crawl-seeds',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            orgId: 1,
            keywords: ['Brussels', 'Antwerp', 'Ghent', 'Charleroi', 'Liège', 'Schaerbeek', 'Anderlecht', 'Bruges'],
          }),
        })
      )
    )
    // Every city becomes its own chip and the input clears.
    for (const city of ['Brussels', 'Antwerp', 'Ghent', 'Charleroi', 'Liège', 'Schaerbeek', 'Anderlecht', 'Bruges']) {
      expect(screen.getByRole('button', { name: new RegExp(city, 'i') })).toBeTruthy()
    }
    expect(input.value).toBe('')
  })

  it('shows an enabled keyword as a solid, pressed chip and a disabled one as an outlined, unpressed chip', () => {
    render(
      <SettingsView
        role="owner"
        orgId={1}
        seeds={[
          { id: 1, keyword: 'brussels', enabled: true },
          { id: 2, keyword: 'antwerp', enabled: false },
        ]}
        accountsCount={0}
      />
    )
    expect(screen.getByRole('button', { name: /brussels/i }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByRole('button', { name: /antwerp/i }).getAttribute('aria-pressed')).toBe('false')
  })

  it('toggles a keyword off when clicking its enabled chip', async () => {
    const fetchMock = vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({}) } as Response))
    global.fetch = fetchMock
    render(
      <SettingsView
        role="owner"
        orgId={1}
        seeds={[{ id: 1, keyword: 'brussels', enabled: true }]}
        accountsCount={0}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: /brussels/i }))

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        '/vidi/api/crawl-seeds',
        expect.objectContaining({
          method: 'PATCH',
          body: JSON.stringify({ orgId: 1, keyword: 'brussels', enabled: false }),
        })
      )
    )
    expect(screen.getByRole('button', { name: /brussels/i }).getAttribute('aria-pressed')).toBe('false')
  })

  it('picks up seeds that arrive after the initial mount (parent fetch resolving late)', () => {
    const { rerender } = render(<SettingsView role="owner" orgId={1} seeds={[]} accountsCount={0} />)
    expect(screen.queryByText('brussels')).toBeNull()

    rerender(
      <SettingsView
        role="owner"
        orgId={1}
        seeds={[{ id: 1, keyword: 'brussels', enabled: true }]}
        accountsCount={0}
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
