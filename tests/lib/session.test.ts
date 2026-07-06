import { describe, it, expect, afterEach } from 'vitest'
import { sessionOptions } from '../../src/lib/authz/session'

describe('session options', () => {
  const originalPublicUrl = process.env.VIDI_PUBLIC_URL

  afterEach(() => {
    if (originalPublicUrl === undefined) delete process.env.VIDI_PUBLIC_URL
    else process.env.VIDI_PUBLIC_URL = originalPublicUrl
  })

  it('scopes cookie to /vidi and requires a secret', () => {
    process.env.VIDI_COOKIE_SECRET = 'x'.repeat(32)
    process.env.VIDI_PUBLIC_URL = 'https://belgium-atmosphe.re/vidi'
    const opts = sessionOptions()
    expect(opts.cookieOptions?.path).toBe('/vidi')
    expect(opts.password).toHaveLength(32)
  })

  it('sets secure=true when VIDI_PUBLIC_URL is https (production)', () => {
    process.env.VIDI_COOKIE_SECRET = 'x'.repeat(32)
    process.env.VIDI_PUBLIC_URL = 'https://belgium-atmosphe.re/vidi'
    const opts = sessionOptions()
    expect(opts.cookieOptions?.secure).toBe(true)
  })

  it('sets secure=false when VIDI_PUBLIC_URL is the http://127.0.0.1 loopback base', () => {
    process.env.VIDI_COOKIE_SECRET = 'x'.repeat(32)
    process.env.VIDI_PUBLIC_URL = 'http://127.0.0.1:3000/vidi'
    const opts = sessionOptions()
    expect(opts.cookieOptions?.secure).toBe(false)
  })
})
