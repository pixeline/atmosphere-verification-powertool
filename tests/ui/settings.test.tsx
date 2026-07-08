import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { SettingsView } from '../../src/app/(app)/settings/page'

describe('SettingsView', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
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
})
