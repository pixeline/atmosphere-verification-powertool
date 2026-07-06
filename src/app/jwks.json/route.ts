import { NextResponse } from 'next/server'
import { getKeyset } from '../../lib/atproto/oauthClient'

export async function GET() {
  const keyset = await getKeyset()
  return NextResponse.json(keyset.publicJwks)
}
