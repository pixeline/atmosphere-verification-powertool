import { NextResponse } from 'next/server'
import { clientMetadata } from '../../lib/atproto/oauthClient'

export function GET() {
  return NextResponse.json(clientMetadata())
}
