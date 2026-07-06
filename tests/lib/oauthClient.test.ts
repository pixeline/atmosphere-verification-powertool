import { describe, it, expect, beforeAll } from 'vitest'
import { isLoopbackBase } from '../../src/lib/atproto/oauthClient'

const TEST_JWK = {
  kty: 'EC',
  x: '3F6wwPuhMneoXQOrlxhS8SB57PcMN2Yt92i1cTmkChU',
  y: 'pvmjgYtDnlIbjOd8dft7BNlmYiisPVvFYO_FoBb7STE',
  crv: 'P-256',
  d: 'phIuf5AD4dvvWapuLzGUtso3MAdIglA_7xBxRYrjmxM',
  kid: 'test-key-1',
  alg: 'ES256',
  use: 'sig',
}

let GET: any
beforeAll(async () => {
  process.env.VIDI_PUBLIC_URL = 'https://belgium-atmosphe.re/vidi'
  process.env.VIDI_OAUTH_PRIVATE_JWK = JSON.stringify(TEST_JWK)
  ;({ GET } = await import('../../src/app/client-metadata.json/route'))
})

describe('client-metadata', () => {
  it('advertises the correct client_id and scope', async () => {
    const body = await (await GET()).json()
    expect(body.client_id).toBe('https://belgium-atmosphe.re/vidi/client-metadata.json')
    expect(body.redirect_uris).toContain('https://belgium-atmosphe.re/vidi/api/auth/callback')
    expect(body.scope).toBe('atproto transition:generic')
    expect(body.dpop_bound_access_tokens).toBe(true)
  })

  it('is configured as a confidential client (private_key_jwt)', async () => {
    const body = await (await GET()).json()
    expect(body.token_endpoint_auth_method).toBe('private_key_jwt')
    expect(body.token_endpoint_auth_signing_alg).toBe('ES256')
    expect(body.jwks_uri).toBe('https://belgium-atmosphe.re/vidi/jwks.json')
    expect(body.jwks).toBeUndefined()
  })
})

describe('isLoopbackBase', () => {
  it('is true for a 127.0.0.1 base', () => {
    expect(isLoopbackBase('http://127.0.0.1:3000/vidi')).toBe(true)
  })

  it('is true for a localhost base', () => {
    expect(isLoopbackBase('http://localhost:3000/vidi')).toBe(true)
  })

  it('is true for the IPv6 loopback [::1] base', () => {
    expect(isLoopbackBase('http://[::1]:3000/vidi')).toBe(true)
  })

  it('is false for a real https host', () => {
    expect(isLoopbackBase('https://belgium-atmosphe.re/vidi')).toBe(false)
  })
})

describe('clientMetadata in loopback mode', () => {
  beforeAll(() => {
    process.env.VIDI_PUBLIC_URL = 'http://127.0.0.1:3000/vidi'
    delete process.env.VIDI_OAUTH_PRIVATE_JWK
  })

  it('builds a public loopback client with no keyset/jwks and a 127.0.0.1 redirect_uri', async () => {
    // Re-import fresh so module-level env reads (VIDI_PUBLIC_URL) pick up the
    // loopback value set above rather than a cached confidential-mode result.
    const { clientMetadata } = await import('../../src/lib/atproto/oauthClient')
    const metadata = clientMetadata()

    expect(metadata.token_endpoint_auth_method).toBe('none')
    expect(metadata.redirect_uris[0]).toContain('127.0.0.1')
    expect(metadata.redirect_uris[0]).not.toContain('localhost')
    expect(metadata.redirect_uris[0]).toBe('http://127.0.0.1:3000/vidi/api/auth/callback')
    expect((metadata as Record<string, unknown>).jwks).toBeUndefined()
    expect((metadata as Record<string, unknown>).jwks_uri).toBeUndefined()
    // The special loopback client_id itself is the `http://localhost` form
    // (per the atproto OAuth spec); scope/redirect_uri are carried as query
    // params on it, NOT as a literal 127.0.0.1 origin.
    expect(metadata.client_id.startsWith('http://localhost')).toBe(true)
    expect(metadata.scope).toBe('atproto transition:generic')
  })
})
