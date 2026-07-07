import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { SearchForm } from '../../src/components/SearchForm'

// SearchForm uses fixed element ids (e.g. "search-followed-by-verified"), so
// multiple renders left mounted across tests in this file collide. Clean up
// after each test to keep every render isolated.
afterEach(cleanup)

describe('SearchForm', () => {
  it('renders all four filter controls', () => {
    render(<SearchForm trustedVerifiers={[{ did: 'did:plc:tv', handle: 'france-atmosphe.re' }]} onSearch={vi.fn()} />)
    expect(screen.getByLabelText(/text in bio or handle/i)).toBeTruthy()
    expect(screen.getByRole('checkbox', { name: /handle is a domain/i })).toBeTruthy()
    expect(screen.getByRole('checkbox', { name: /followed by a verified account/i })).toBeTruthy()
    expect(screen.getByText(/france-atmosphe\.re/)).toBeTruthy()
  })

  it('disables and clears the verified-by and followed-by-verified controls when live network is checked', () => {
    const onSearch = vi.fn()
    render(<SearchForm trustedVerifiers={[{ did: 'did:plc:tv', handle: 'tv.example' }]} onSearch={onSearch} />)

    const followedCheckbox = screen.getByRole('checkbox', { name: /followed by a verified account/i })
    const tvCheckbox = screen.getByRole('checkbox', { name: /tv\.example/i })
    fireEvent.click(followedCheckbox)
    fireEvent.click(tvCheckbox)
    expect(followedCheckbox.getAttribute('aria-checked')).toBe('true')
    expect(tvCheckbox.getAttribute('aria-checked')).toBe('true')

    const liveCheckbox = screen.getByRole('checkbox', { name: /search the live network/i })
    fireEvent.click(liveCheckbox)

    expect(followedCheckbox.getAttribute('aria-checked')).toBe('false')
    expect(followedCheckbox.getAttribute('aria-disabled')).toBe('true')
    expect(tvCheckbox.getAttribute('aria-checked')).toBe('false')
    expect(tvCheckbox.getAttribute('aria-disabled')).toBe('true')
  })
})
