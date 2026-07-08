import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { SearchForm } from '../../src/components/SearchForm'

// SearchForm uses fixed element ids (e.g. "search-followed-by-verified"), so
// multiple renders left mounted across tests in this file collide. Clean up
// after each test to keep every render isolated.
afterEach(cleanup)

describe('SearchForm', () => {
  it('renders the primary search field, filter controls, and the search-scope toggle', () => {
    render(<SearchForm trustedVerifiers={[{ did: 'did:plc:tv', handle: 'france-atmosphe.re' }]} onSearch={vi.fn()} />)
    expect(screen.getByLabelText(/search in bio or handle/i)).toBeTruthy()
    expect(screen.getByRole('checkbox', { name: /only domain handles/i })).toBeTruthy()
    expect(screen.getByRole('checkbox', { name: /followed by a verified account/i })).toBeTruthy()
    expect(screen.getByRole('button', { name: /harvested accounts/i })).toBeTruthy()
    expect(screen.getByRole('button', { name: /^live network$/i })).toBeTruthy()
  })

  it('hides the "Verified by" filter entirely when there are no trusted verifiers configured', () => {
    render(<SearchForm trustedVerifiers={[]} onSearch={vi.fn()} />)
    fireEvent.click(screen.getByRole('checkbox', { name: /followed by a verified account/i }))
    expect(screen.queryByText(/verified by/i)).toBeNull()
  })

  it('hides "Verified by" until "Followed by a verified account" is checked, even when trusted verifiers exist', () => {
    render(<SearchForm trustedVerifiers={[{ did: 'did:plc:tv', handle: 'france-atmosphe.re' }]} onSearch={vi.fn()} />)
    expect(screen.queryByText(/verified by/i)).toBeNull()
    expect(screen.queryByText(/france-atmosphe\.re/)).toBeNull()

    fireEvent.click(screen.getByRole('checkbox', { name: /followed by a verified account/i }))

    expect(screen.getByText(/verified by/i)).toBeTruthy()
    expect(screen.getByText(/france-atmosphe\.re/)).toBeTruthy()
  })

  it('clears the verified-by selection when "Followed by a verified account" is unchecked', () => {
    render(<SearchForm trustedVerifiers={[{ did: 'did:plc:tv', handle: 'tv.example' }]} onSearch={vi.fn()} />)
    const followedCheckbox = screen.getByRole('checkbox', { name: /followed by a verified account/i })

    fireEvent.click(followedCheckbox)
    fireEvent.click(screen.getByRole('checkbox', { name: /tv\.example/i }))
    fireEvent.click(followedCheckbox) // uncheck — fieldset disappears
    fireEvent.click(followedCheckbox) // re-check — fieldset reappears

    expect(screen.getByRole('checkbox', { name: /tv\.example/i }).getAttribute('aria-checked')).toBe('false')
  })

  it('disables and clears the verified-by and followed-by-verified controls when the live network scope is selected', () => {
    const onSearch = vi.fn()
    render(<SearchForm trustedVerifiers={[{ did: 'did:plc:tv', handle: 'tv.example' }]} onSearch={onSearch} />)

    const followedCheckbox = screen.getByRole('checkbox', { name: /followed by a verified account/i })
    fireEvent.click(followedCheckbox)
    const tvCheckbox = screen.getByRole('checkbox', { name: /tv\.example/i })
    fireEvent.click(tvCheckbox)
    expect(followedCheckbox.getAttribute('aria-checked')).toBe('true')
    expect(tvCheckbox.getAttribute('aria-checked')).toBe('true')

    fireEvent.click(screen.getByRole('button', { name: /^live network$/i }))

    expect(followedCheckbox.getAttribute('aria-checked')).toBe('false')
    expect(followedCheckbox.getAttribute('aria-disabled')).toBe('true')
    // The fieldset itself disappears along with followedByVerified clearing —
    // if it didn't, the stale tv checkbox would still need to report cleared+disabled.
    expect(screen.queryByRole('checkbox', { name: /tv\.example/i })).toBeNull()
  })

  it('re-enables verified-by controls when switching back to harvested accounts', () => {
    render(<SearchForm trustedVerifiers={[{ did: 'did:plc:tv', handle: 'tv.example' }]} onSearch={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: /^live network$/i }))
    fireEvent.click(screen.getByRole('button', { name: /harvested accounts/i }))

    const followedCheckbox = screen.getByRole('checkbox', { name: /followed by a verified account/i })
    expect(followedCheckbox.getAttribute('aria-disabled')).not.toBe('true')
    fireEvent.click(followedCheckbox)
    expect(followedCheckbox.getAttribute('aria-checked')).toBe('true')
  })

  it('reflects the selected scope via aria-pressed on the toggle buttons', () => {
    render(<SearchForm trustedVerifiers={[]} onSearch={vi.fn()} />)
    const harvested = screen.getByRole('button', { name: /harvested accounts/i })
    const live = screen.getByRole('button', { name: /^live network$/i })
    expect(harvested.getAttribute('aria-pressed')).toBe('true')
    expect(live.getAttribute('aria-pressed')).toBe('false')

    fireEvent.click(live)

    expect(harvested.getAttribute('aria-pressed')).toBe('false')
    expect(live.getAttribute('aria-pressed')).toBe('true')
  })
})
