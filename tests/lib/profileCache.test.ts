import { describe, it, expect, vi, beforeEach } from 'vitest'

const getProfile = vi.fn()
vi.mock('../../src/lib/atproto/publicAgent', () => ({
  getPublicAppViewAgent: () => ({ getProfile: (args: unknown) => getProfile(args) }),
}))

import { getActorAvatar } from '../../src/lib/atproto/profileCache'

beforeEach(() => {
  getProfile.mockReset()
})

describe('getActorAvatar', () => {
  it('returns the avatar url and serves it from cache within the TTL', async () => {
    getProfile.mockResolvedValue({ data: { avatar: 'https://a/pic.jpg' } })
    expect(await getActorAvatar('did:plc:a', 1000)).toBe('https://a/pic.jpg')
    getProfile.mockClear()
    expect(await getActorAvatar('did:plc:a', 1000 + 60_000)).toBe('https://a/pic.jpg')
    expect(getProfile).not.toHaveBeenCalled()
  })

  it('returns null when the profile has no avatar', async () => {
    getProfile.mockResolvedValue({ data: {} })
    expect(await getActorAvatar('did:plc:b', 1000)).toBeNull()
  })

  it('recomputes once the TTL has expired', async () => {
    getProfile
      .mockResolvedValueOnce({ data: { avatar: 'https://a/1.jpg' } })
      .mockResolvedValueOnce({ data: { avatar: 'https://a/2.jpg' } })
    await getActorAvatar('did:plc:c', 1000)
    expect(await getActorAvatar('did:plc:c', 1000 + 6 * 60_000)).toBe('https://a/2.jpg')
    expect(getProfile).toHaveBeenCalledTimes(2)
  })

  it('serves the last known value on a failed refresh (does not poison the cache)', async () => {
    getProfile.mockResolvedValueOnce({ data: { avatar: 'https://a/pic.jpg' } })
    await getActorAvatar('did:plc:d', 1000)
    getProfile.mockRejectedValueOnce(new Error('network'))
    expect(await getActorAvatar('did:plc:d', 1000 + 6 * 60_000)).toBe('https://a/pic.jpg')
  })

  it('returns null on failure when nothing is cached', async () => {
    getProfile.mockRejectedValue(new Error('network'))
    expect(await getActorAvatar('did:plc:e', 1000)).toBeNull()
  })
})
