import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { SearchForm } from '../../src/components/SearchForm'

describe('SearchForm', () => {
  it('renders all four filter controls', () => {
    render(<SearchForm trustedVerifiers={[{ did: 'did:plc:tv', handle: 'france-atmosphe.re' }]} onSearch={vi.fn()} />)
    expect(screen.getByLabelText(/text in bio or handle/i)).toBeTruthy()
    expect(screen.getByLabelText(/handle is a domain/i)).toBeTruthy()
    expect(screen.getByLabelText(/followed by a verified account/i)).toBeTruthy()
    expect(screen.getByText(/france-atmosphe\.re/)).toBeTruthy()
  })
})
