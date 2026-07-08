import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, waitFor, act, cleanup } from '@testing-library/react'
import { useOrg } from '@/lib/hooks/useOrg'
import { notifyVerifiedCountChanged } from '@/lib/verifiedCountBus'

afterEach(cleanup)

describe('useOrg', () => {
  beforeEach(() => {
    global.fetch = vi.fn()
  })

  it('exposes verifiedCount from the org/context response', async () => {
    ;(global.fetch as any).mockResolvedValue({
      status: 200,
      json: async () => ({ orgId: 1, role: 'owner', isAllowlisted: true, handle: 'x', verifiedCount: 7 }),
    })
    const { result } = renderHook(() => useOrg())
    await waitFor(() => expect(result.current.verifiedCount).toBe(7))
  })

  it('re-fetches org context when notified via the verifiedCountBus', async () => {
    let call = 0
    ;(global.fetch as any).mockImplementation(async () => {
      call++
      return {
        status: 200,
        json: async () => ({ orgId: 1, role: 'owner', isAllowlisted: true, handle: 'x', verifiedCount: call }),
      }
    })
    const { result } = renderHook(() => useOrg())
    await waitFor(() => expect(result.current.verifiedCount).toBe(1))

    act(() => {
      notifyVerifiedCountChanged()
    })

    await waitFor(() => expect(result.current.verifiedCount).toBe(2))
  })
})
