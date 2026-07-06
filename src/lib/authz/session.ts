import { getIronSession, type SessionOptions } from 'iron-session'
import { cookies } from 'next/headers'
import { requireEnv } from '../env'
import { isLoopbackBase } from '../atproto/oauthClient'

export type ActorSession = { did?: string }

/**
 * The session cookie's `secure` flag must be false when running the local
 * loopback dev flow over plain http://127.0.0.1 — browsers refuse to set (or
 * silently drop) `Secure` cookies on a non-HTTPS origin, so login would
 * appear to succeed but the session would never actually persist. In every
 * other case (a real https:// VIDI_PUBLIC_URL) it stays true.
 */
function secureCookies(): boolean {
  const publicUrl = requireEnv('VIDI_PUBLIC_URL')
  if (isLoopbackBase(publicUrl)) return false
  try {
    return new URL(publicUrl).protocol === 'https:'
  } catch {
    return true
  }
}

export function sessionOptions(): SessionOptions {
  return {
    password: requireEnv('VIDI_COOKIE_SECRET'),
    cookieName: 'vidi_session',
    cookieOptions: { path: '/vidi', httpOnly: true, secure: secureCookies(), sameSite: 'lax' },
  }
}

export async function getSession() {
  return getIronSession<ActorSession>(await cookies(), sessionOptions())
}

export async function getActor(): Promise<{ did: string } | null> {
  const s = await getSession()
  return s.did ? { did: s.did } : null
}
