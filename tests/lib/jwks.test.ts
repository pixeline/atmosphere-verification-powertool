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
  ;({ GET } = await import('../../src/app/jwks.json/route'))
})

describe('jwks.json', () => {
  it('serves only the public half of the key (no private "d")', async () => {
    const body = await (await GET()).json()
    expect(body.keys).toHaveLength(1)
    const key = body.keys[0]
    expect(key.kty).toBe('EC')
    expect(key.crv).toBe('P-256')
    expect(key.x).toBe(TEST_JWK.x)
    expect(key.y).toBe(TEST_JWK.y)
    expect(key.d).toBeUndefined()
  })
})
