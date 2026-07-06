import { getIronSession, type SessionOptions } from 'iron-session'
import { cookies } from 'next/headers'
import { requireEnv } from '../env'

export type ActorSession = { did?: string }

export function sessionOptions(): SessionOptions {
  return {
    password: requireEnv('VIDI_COOKIE_SECRET'),
    cookieName: 'vidi_session',
    cookieOptions: { path: '/vidi', httpOnly: true, secure: true, sameSite: 'lax' },
  }
}

export async function getSession() {
  return getIronSession<ActorSession>(await cookies(), sessionOptions())
}

export async function getActor(): Promise<{ did: string } | null> {
  const s = await getSession()
  return s.did ? { did: s.did } : null
}
