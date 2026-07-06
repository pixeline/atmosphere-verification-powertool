import { NextResponse } from 'next/server'
import { getSession } from '@/lib/authz/session'

export async function POST() {
  const s = await getSession()
  s.destroy()
  return NextResponse.json({ ok: true })
}
