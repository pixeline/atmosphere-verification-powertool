import { NextRequest, NextResponse } from 'next/server'
import { getOAuthClient } from '@/lib/atproto/oauthClient'
import { getSession } from '@/lib/authz/session'

export async function GET(req: NextRequest) {
  const client = await getOAuthClient()
  const { session } = await client.callback(req.nextUrl.searchParams)
  const s = await getSession()
  s.did = session.did
  await s.save()
  return NextResponse.redirect(`${process.env.VIDI_PUBLIC_URL}/search`)
}
