import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { SearchForm } from '../../src/components/SearchForm'

// SearchForm uses fixed element ids, so multiple renders left mounted across
// tests in this file collide. Clean up after each test to keep renders isolated.
afterEach(cleanup)

describe('SearchForm', () => {
  it('renders the primary search field, filter controls, and the search-scope toggle', () => {
    render(<SearchForm onSearch={vi.fn()} />)
    expect(screen.getByLabelText(/search in bio or handle/i)).toBeTruthy()
    expect(screen.getByRole('checkbox', { name: /only domain handles/i })).toBeTruthy()
    expect(screen.getByRole('checkbox', { name: /hide accounts already verified by us/i })).toBeTruthy()
    expect(screen.getByRole('button', { name: /harvested accounts/i })).toBeTruthy()
    expect(screen.getByRole('button', { name: /^live network$/i })).toBeTruthy()
  })

  it('no longer renders the followed-by-verified or verified-by controls', () => {
    render(<SearchForm onSearch={vi.fn()} />)
    expect(screen.queryByRole('checkbox', { name: /followed by a verified account/i })).toBeNull()
    expect(screen.queryByText(/^verified by$/i)).toBeNull()
  })

  it('reflects the selected scope via aria-pressed on the toggle buttons', () => {
    render(<SearchForm onSearch={vi.fn()} />)
    const harvested = screen.getByRole('button', { name: /harvested accounts/i })
    const live = screen.getByRole('button', { name: /^live network$/i })
    expect(harvested.getAttribute('aria-pressed')).toBe('true')
    expect(live.getAttribute('aria-pressed')).toBe('false')

    fireEvent.click(live)

    expect(harvested.getAttribute('aria-pressed')).toBe('false')
    expect(live.getAttribute('aria-pressed')).toBe('true')
  })

  it('defaults "Hide accounts already verified by us" to checked', () => {
    render(<SearchForm onSearch={vi.fn()} />)
    const checkbox = screen.getByRole('checkbox', { name: /hide accounts already verified by us/i })
    expect(checkbox.getAttribute('aria-checked')).toBe('true')
  })

  it('includes excludeVerifiedByUs and activeWithinDays in the submitted filters', () => {
    const onSearch = vi.fn()
    render(<SearchForm onSearch={onSearch} />)
    fireEvent.click(screen.getByRole('button', { name: /^search$/i }))
    expect(onSearch).toHaveBeenCalledWith(
      expect.objectContaining({ excludeVerifiedByUs: true, activeWithinDays: null })
    )
  })

  it('does not include followedByVerified or verifiedByAnyOf in the submitted filters', () => {
    const onSearch = vi.fn()
    render(<SearchForm onSearch={onSearch} />)
    fireEvent.click(screen.getByRole('button', { name: /^search$/i }))
    const payload = onSearch.mock.calls[0][0]
    expect(payload).not.toHaveProperty('followedByVerified')
    expect(payload).not.toHaveProperty('verifiedByAnyOf')
  })

  it('selects an activity bucket and includes it in submitted filters', () => {
    const onSearch = vi.fn()
    render(<SearchForm onSearch={onSearch} />)
    fireEvent.click(screen.getByRole('button', { name: /^1 month$/i }))
    fireEvent.click(screen.getByRole('button', { name: /^search$/i }))
    expect(onSearch).toHaveBeenCalledWith(expect.objectContaining({ activeWithinDays: 30 }))
  })

  it('disables and clears the activity-timeframe control when the live network scope is selected', () => {
    render(<SearchForm onSearch={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: /^1 month$/i }))
    fireEvent.click(screen.getByRole('button', { name: /^live network$/i }))

    const oneMonth = screen.getByRole('button', { name: /^1 month$/i }) as HTMLButtonElement
    expect(oneMonth.getAttribute('aria-pressed')).toBe('false')
    // A plain (non-composite) Button's `disabled` prop renders the native
    // `disabled` attribute, not `aria-disabled`.
    expect(oneMonth.disabled).toBe(true)
    const anyTime = screen.getByRole('button', { name: /^any time$/i })
    expect(anyTime.getAttribute('aria-pressed')).toBe('true')
  })

  it('re-enables the activity control when switching back to harvested accounts', () => {
    render(<SearchForm onSearch={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: /^live network$/i }))
    fireEvent.click(screen.getByRole('button', { name: /harvested accounts/i }))
    const oneMonth = screen.getByRole('button', { name: /^1 month$/i }) as HTMLButtonElement
    expect(oneMonth.disabled).toBe(false)
  })
})
