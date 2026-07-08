import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'

const useOrgMock = vi.fn()
vi.mock('@/lib/hooks/useOrg', () => ({ useOrg: () => useOrgMock() }))
vi.mock('next/navigation', () => ({ usePathname: () => '/search' }))

import AppLayout from '../../src/app/(app)/layout'

afterEach(cleanup)

describe('AppLayout', () => {
  it('shows the verified count next to the Vidi logo when known', () => {
    useOrgMock.mockReturnValue({
      orgId: 1,
      role: 'owner',
      isAllowlisted: true,
      handle: 'org.example.com',
      authenticated: true,
      loading: false,
      verifiedCount: 42,
      refresh: vi.fn(),
    })
    render(<AppLayout>{null}</AppLayout>)
    expect(screen.getByText(/42 verified/i)).toBeTruthy()
  })

  it('hides the verified count while it is not yet known', () => {
    useOrgMock.mockReturnValue({
      orgId: null,
      role: null,
      isAllowlisted: false,
      handle: null,
      authenticated: false,
      loading: true,
      verifiedCount: null,
      refresh: vi.fn(),
    })
    render(<AppLayout>{null}</AppLayout>)
    expect(screen.queryByText(/verified/i)).toBeNull()
  })
})
