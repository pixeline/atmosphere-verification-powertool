import { describe, it, expect, vi } from 'vitest'
import { notifyVerifiedCountChanged, subscribeVerifiedCountChanged } from '../../src/lib/verifiedCountBus'

describe('verifiedCountBus', () => {
  it('calls a subscribed listener when notified', () => {
    const listener = vi.fn()
    subscribeVerifiedCountChanged(listener)
    notifyVerifiedCountChanged()
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('stops calling a listener after it unsubscribes', () => {
    const listener = vi.fn()
    const unsubscribe = subscribeVerifiedCountChanged(listener)
    unsubscribe()
    notifyVerifiedCountChanged()
    expect(listener).not.toHaveBeenCalled()
  })
})
