import { NextResponse } from 'next/server'
import { db } from '../../../db/client'
import { trustedVerifiers } from '../../../db/schema'

export async function GET() {
  const verifiers = await db.select().from(trustedVerifiers)
  return NextResponse.json({ verifiers })
}
