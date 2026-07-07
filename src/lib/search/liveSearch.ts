import { getPublicAppViewAgent } from '../atproto/publicAgent'
import { isCustomDomain } from '../domain/handleClassifier'

export type LiveActor = {
  did: string
  handle: string
  displayName: string | null
  description: string | null
  isCustomDomain: boolean
}

export async function searchActorsLive(text: string, limit = 25): Promise<LiveActor[]> {
  const agent = getPublicAppViewAgent()
  const { data } = await agent.app.bsky.actor.searchActors({ q: text, limit })
  return data.actors.map((a) => ({
    did: a.did,
    handle: a.handle,
    displayName: a.displayName ?? null,
    description: a.description ?? null,
    isCustomDomain: isCustomDomain(a.handle),
  }))
}
