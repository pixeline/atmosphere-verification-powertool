import { NextRequest, NextResponse } from 'next/server'
import { getOAuthClient } from '@/lib/atproto/oauthClient'

export async function POST(req: NextRequest) {
  const { handle } = await req.json()
  const client = await getOAuthClient()
  const url = await client.authorize(handle, { scope: 'atproto transition:generic' })
  return NextResponse.json({ url: url.toString() })
}
