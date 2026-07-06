import { describe, it, expect } from 'vitest'
import { sessionOptions } from '../../src/lib/authz/session'
describe('session options', () => {
  it('scopes cookie to /vidi and requires a secret', () => {
    process.env.VIDI_COOKIE_SECRET = 'x'.repeat(32)
    const opts = sessionOptions()
    expect(opts.cookieOptions?.path).toBe('/vidi')
    expect(opts.password).toHaveLength(32)
  })
})
