import { describe, it, expect, beforeAll } from 'vitest'
import crypto from 'node:crypto'

let encryptJson: any, decryptJson: any
beforeAll(async () => {
  process.env.VIDI_TOKEN_ENC_KEY = crypto.randomBytes(32).toString('base64')
  ;({ encryptJson, decryptJson } = await import('../../src/lib/crypto/tokenCrypto'))
})

describe('tokenCrypto', () => {
  it('round-trips an object', () => {
    const obj = { refresh: 'abc', n: 1 }
    const enc = encryptJson(obj)
    expect(enc).not.toContain('abc')
    expect(decryptJson(enc)).toEqual(obj)
  })
  it('rejects tampered ciphertext', () => {
    const enc = encryptJson({ a: 1 })
    const bad = Buffer.from(enc, 'base64'); bad[bad.length - 1] ^= 0xff
    expect(() => decryptJson(bad.toString('base64'))).toThrow()
  })
})
