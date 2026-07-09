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

  it('renders one checkmark per verifier with the handle as a title tooltip', () => {
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
    const tv1 = document.querySelector('[title="tv-one.example"]')
    const tv2 = document.querySelector('[title="tv-two.example"]')
    expect(tv1).toBeTruthy()
    expect(tv2).toBeTruthy()
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
    const a = document.querySelector('[title="a.example"]')!
    const b = document.querySelector('[title="b.example"]')!
    expect(a.className).not.toBe(b.className)
  })

  it('shows the followers/following/last-active signals line for an indexed account', () => {
    render(
      <AccountCard
        acc={{ ...baseAcc, followersCount: 42, followsCount: 7, lastActiveAt: new Date().toISOString(), indexed: true }}
      />
    )
    expect(screen.getByText(/7 following/i)).toBeTruthy()
    expect(screen.getByText(/42 followers/i)).toBeTruthy()
    expect(screen.getByText(/Active within 7 days/i)).toBeTruthy()
  })

  it('hides the signals line for a live-only, not-yet-indexed result', () => {
    render(<AccountCard acc={{ ...baseAcc, indexed: false }} />)
    expect(screen.queryByText(/following/i)).toBeNull()
    expect(screen.queryByText(/followers/i)).toBeNull()
  })

  it('shows an em dash for null follower/following counts instead of "0"', () => {
    render(
      <AccountCard
        acc={{ ...baseAcc, followersCount: null, followsCount: null, lastActiveAt: null, indexed: true }}
      />
    )
    expect(screen.getByText(/— following/)).toBeTruthy()
    expect(screen.getByText(/— followers/)).toBeTruthy()
    expect(screen.queryByText(/0 following/)).toBeNull()
    expect(screen.queryByText(/0 followers/)).toBeNull()
  })

  it('still shows "0" for genuinely zero follower/following counts (not an em dash)', () => {
    render(
      <AccountCard
        acc={{ ...baseAcc, followersCount: 0, followsCount: 0, lastActiveAt: null, indexed: true }}
      />
    )
    expect(screen.getByText(/0 following/)).toBeTruthy()
    expect(screen.getByText(/0 followers/)).toBeTruthy()
    expect(screen.queryByText(/— following/)).toBeNull()
    expect(screen.queryByText(/— followers/)).toBeNull()
  })
})
