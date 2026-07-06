import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import LoginPage from '../../src/app/page'

describe('LoginPage', () => {
  it('renders a handle input', () => {
    render(<LoginPage />)
    expect(screen.getByPlaceholderText(/handle/i)).toBeTruthy()
  })
})
