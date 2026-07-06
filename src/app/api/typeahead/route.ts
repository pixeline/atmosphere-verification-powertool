import { AtpAgent } from '@atproto/api'
import { NextRequest, NextResponse } from 'next/server'

const TYPEAHEAD_URL = () => process.env.VIDI_TYPEAHEAD_URL ?? 'https://typeahead.waow.tech'

export type TypeaheadActor = {
  did: string
  handle: string
  displayName?: string
  avatar?: string
}

/**
 * Public, pre-login typeahead for handles. Mirrors the query shape used by
 * `src/crawler/keywordSeed.ts` (`app.bsky.actor.searchActorsTypeahead` against a
 * dedicated, configurable typeahead endpoint) but returns a trimmed actor shape
 * for the login autocomplete. No auth required — this runs before sign-in, like
 * the public `trusted-verifiers` route.
 */
export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get('q')?.trim() ?? ''
  if (q.length < 2) {
    return NextResponse.json({ actors: [] })
  }

  try {
    const agent = new AtpAgent({ service: TYPEAHEAD_URL() })
    const { data } = await agent.app.bsky.actor.searchActorsTypeahead({ q, limit: 8 })
    const actors: TypeaheadActor[] = data.actors.map((a) => ({
      did: a.did,
      handle: a.handle,
      displayName: a.displayName,
      avatar: a.avatar,
    }))
    return NextResponse.json({ actors })
  } catch {
    return NextResponse.json({ actors: [] })
  }
}
