import type { AtpAgent } from '@atproto/api'

export async function collectFollowedByVerified(agent: AtpAgent, verifiedDids: string[]): Promise<Map<string, string[]>> {
  const map = new Map<string, string[]>()
  for (const v of verifiedDids) {
    let cursor: string | undefined
    do {
      const { data } = await agent.getFollows({ actor: v, limit: 100, cursor })
      for (const f of data.follows) {
        const arr = map.get(f.did) ?? []
        if (!arr.includes(v)) arr.push(v)
        map.set(f.did, arr)
      }
      cursor = data.cursor
    } while (cursor)
  }
  return map
}
