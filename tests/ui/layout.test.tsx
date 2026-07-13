import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, cleanup, waitFor } from '@testing-library/react'

const useOrgMock = vi.fn()
const replaceMock = vi.fn()
vi.mock('@/lib/hooks/useOrg', () => ({ useOrg: () => useOrgMock() }))
vi.mock('next/navigation', () => ({ usePathname: () => '/search', useRouter: () => ({ replace: replaceMock }) }))

import AppLayout from '../../src/app/(app)/layout'

afterEach(cleanup)
beforeEach(() => replaceMock.mockClear())

describe('AppLayout', () => {
  it('shows the Trusted Verifier org handle and verified count next to the Vidi logo', () => {
    useOrgMock.mockReturnValue({
      orgId: 1,
      role: 'owner',
      isAllowlisted: true,
      handle: 'org.example.com',
      orgHandle: 'belgium-atmosphe.re',
      authenticated: true,
      loading: false,
      verifiedCount: 42,
      refresh: vi.fn(),
    })
    render(<AppLayout>{null}</AppLayout>)
    expect(screen.getByText('belgium-atmosphe.re')).toBeTruthy()
    expect(screen.getByText(/42 verified/i)).toBeTruthy()
  })

  it('shows the org handle without a count while the count is not yet known', () => {
    useOrgMock.mockReturnValue({
      orgId: 1,
      role: 'owner',
      isAllowlisted: true,
      handle: 'org.example.com',
      orgHandle: 'belgium-atmosphe.re',
      authenticated: true,
      loading: false,
      verifiedCount: null,
      refresh: vi.fn(),
    })
    render(<AppLayout>{null}</AppLayout>)
    expect(screen.getByText('belgium-atmosphe.re')).toBeTruthy()
    expect(screen.queryByText(/verified/i)).toBeNull()
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

  it('does not render the app shell or children while auth is still resolving', () => {
    useOrgMock.mockReturnValue({
      orgId: null, role: null, isAllowlisted: false, handle: null,
      authenticated: null, loading: true, verifiedCount: null, refresh: vi.fn(),
    })
    render(<AppLayout><div>protected content</div></AppLayout>)
    expect(screen.queryByText('protected content')).toBeNull()
    expect(screen.queryByRole('link', { name: /^vidi$/i })).toBeNull()
    expect(replaceMock).not.toHaveBeenCalled()
  })

  it('redirects to the login page and hides the shell when the user is not authenticated', async () => {
    useOrgMock.mockReturnValue({
      orgId: null, role: null, isAllowlisted: false, handle: null,
      authenticated: false, loading: false, verifiedCount: null, refresh: vi.fn(),
    })
    render(<AppLayout><div>protected content</div></AppLayout>)
    await waitFor(() => expect(replaceMock).toHaveBeenCalledWith('/'))
    expect(screen.queryByText('protected content')).toBeNull()
    expect(screen.queryByRole('button', { name: /sign out/i })).toBeNull()
  })

  it('renders children and never redirects when authenticated', () => {
    useOrgMock.mockReturnValue({
      orgId: 1, role: 'helper', isAllowlisted: true, handle: 'org.example.com',
      avatar: null, authenticated: true, loading: false, verifiedCount: 0, refresh: vi.fn(),
    })
    render(<AppLayout><div>protected content</div></AppLayout>)
    expect(screen.getByText('protected content')).toBeTruthy()
    expect(replaceMock).not.toHaveBeenCalled()
  })

  it('renders the logged-in avatar image when one is available', () => {
    useOrgMock.mockReturnValue({
      orgId: 1, role: 'owner', isAllowlisted: true, handle: 'org.example.com',
      avatar: 'https://av.example/pic.jpg', authenticated: true, loading: false, verifiedCount: 0, refresh: vi.fn(),
    })
    render(<AppLayout>{null}</AppLayout>)
    expect(document.querySelector('img[src="https://av.example/pic.jpg"]')).toBeTruthy()
  })

  it('falls back to the handle initial when no avatar is set', () => {
    useOrgMock.mockReturnValue({
      orgId: 1, role: 'owner', isAllowlisted: true, handle: 'org.example.com',
      avatar: null, authenticated: true, loading: false, verifiedCount: 0, refresh: vi.fn(),
    })
    render(<AppLayout>{null}</AppLayout>)
    expect(document.querySelector('img')).toBeNull()
    expect(screen.getByText('O')).toBeTruthy()
  })

  it('shows the Settings link for an active member (helper), not just owners', () => {
    useOrgMock.mockReturnValue({
      orgId: 1, role: 'helper', isAllowlisted: true, handle: 'pixeline.be',
      avatar: null, authenticated: true, loading: false, verifiedCount: 0, refresh: vi.fn(),
    })
    render(<AppLayout>{null}</AppLayout>)
    expect(screen.getByRole('link', { name: /settings/i })).toBeTruthy()
  })

  it('hides the Settings link for a non-member (no org role)', () => {
    useOrgMock.mockReturnValue({
      orgId: null, role: null, isAllowlisted: true, handle: null,
      avatar: null, authenticated: true, loading: false, verifiedCount: null, refresh: vi.fn(),
    })
    render(<AppLayout>{null}</AppLayout>)
    expect(screen.queryByRole('link', { name: /settings/i })).toBeNull()
  })
})
