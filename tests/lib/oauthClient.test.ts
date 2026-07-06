import { describe, it, expect, beforeAll } from 'vitest'

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
  })
})
