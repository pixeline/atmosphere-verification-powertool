import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { AccountCard } from '../../src/components/AccountCard'

afterEach(cleanup)

const baseAcc = {
  did: 'did:plc:x',
  handle: 'x.bsky.social',
  displayName: 'X Account',
}

describe('AccountCard', () => {
  it('renders a checkbox when onToggle is provided', () => {
    render(<AccountCard acc={baseAcc} selected={false} onToggle={vi.fn()} />)
    expect(screen.getByRole('checkbox')).toBeTruthy()
  })

  it('renders no checkbox when onToggle is omitted', () => {
    render(<AccountCard acc={baseAcc} />)
    expect(screen.queryByRole('checkbox')).toBeNull()
  })

  it('renders the actions slot when provided', () => {
    render(<AccountCard acc={baseAcc} actions={<button>Mark verified</button>} />)
    expect(screen.getByRole('button', { name: /mark verified/i })).toBeTruthy()
  })

  it('renders one checkmark per verifier, each naming the verifier on hover', () => {
    render(
      <AccountCard
        acc={{
          ...baseAcc,
          verifiers: [
            { did: 'did:plc:tv1', handle: 'tv-one.example' },
            { did: 'did:plc:tv2', handle: 'tv-two.example' },
          ],
        }}
      />
    )
    // The hover label lives in the SVG's <title> child, which is also the
    // icon's accessible name — assert via role+name so we verify what a user
    // (and a screen reader) actually gets.
    const tv1 = screen.getByRole('img', { name: 'Verified by tv-one.example' })
    const tv2 = screen.getByRole('img', { name: 'Verified by tv-two.example' })
    expect(tv1.querySelector('title')?.textContent).toBe('Verified by tv-one.example')
    expect(tv2.querySelector('title')?.textContent).toBe('Verified by tv-two.example')
  })

  it('falls back to the DID in the hover label when a verifier has no handle', () => {
    render(<AccountCard acc={{ ...baseAcc, verifiers: [{ did: 'did:plc:nohandle', handle: null }] }} />)
    expect(screen.getByRole('img', { name: 'Verified by did:plc:nohandle' })).toBeTruthy()
  })

  it('gives different verifiers different color classes (not all identical)', () => {
    render(
      <AccountCard
        acc={{
          ...baseAcc,
          verifiers: [
            { did: 'did:plc:aaa', handle: 'a.example' },
            { did: 'did:plc:bbb', handle: 'b.example' },
          ],
        }}
      />
    )
    const a = screen.getByRole('img', { name: 'Verified by a.example' })
    const b = screen.getByRole('img', { name: 'Verified by b.example' })
    expect(a.getAttribute('class')).not.toBe(b.getAttribute('class'))
  })

  it('shows the last-active signal line for an indexed account', () => {
    render(<AccountCard acc={{ ...baseAcc, lastActiveAt: new Date().toISOString(), indexed: true }} />)
    expect(screen.getByText(/Active within 7 days/i)).toBeTruthy()
  })

  it('hides the signals line for a live-only, not-yet-indexed result', () => {
    render(<AccountCard acc={{ ...baseAcc, indexed: false }} />)
    expect(screen.queryByText(/Active/i)).toBeNull()
  })
})
