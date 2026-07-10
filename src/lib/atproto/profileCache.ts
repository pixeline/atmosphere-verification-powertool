import { getPublicAppViewAgent } from './publicAgent'

type CacheEntry = { avatar: string | null; at: number }

const cache = new Map<string, CacheEntry>()
const TTL_MS = 5 * 60 * 1000

/**
 * Cached avatar-URL lookup for a DID via the public AppView. Returns null when
 * the account has no avatar (callers fall back to initials/icon). The header's
 * /api/org/context endpoint is hit on every client-side navigation, so we cache
 * to avoid a getProfile call each time; a failed lookup serves the last known
 * value (or null) without poisoning the cache, so it self-heals on the next try.
 */
export async function getActorAvatar(did: string, now: number = Date.now()): Promise<string | null> {
  const hit = cache.get(did)
  if (hit && now - hit.at < TTL_MS) return hit.avatar
  try {
    const { data } = await getPublicAppViewAgent().getProfile({ actor: did })
    const avatar = data.avatar ?? null
    cache.set(did, { avatar, at: now })
    return avatar
  } catch {
    return hit?.avatar ?? null
  }
}
