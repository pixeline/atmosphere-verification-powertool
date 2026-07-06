import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { requireEnv, validateEnv } from '../../src/lib/env'

const ALL_REQUIRED = ['DATABASE_URL', 'VIDI_PUBLIC_URL', 'VIDI_COOKIE_SECRET', 'VIDI_TOKEN_ENC_KEY', 'VIDI_OAUTH_PRIVATE_JWK']

describe('requireEnv', () => {
  const KEY = 'VIDI_TEST_ONLY_VAR'
  const original = process.env[KEY]

  beforeEach(() => {
    delete process.env[KEY]
  })

  afterEach(() => {
    if (original === undefined) delete process.env[KEY]
    else process.env[KEY] = original
  })

  it('throws when the var is unset', () => {
    expect(() => requireEnv(KEY)).toThrow('Missing required env var: VIDI_TEST_ONLY_VAR')
  })

  it('throws when the var is set to an empty string', () => {
    process.env[KEY] = ''
    expect(() => requireEnv(KEY)).toThrow('Missing required env var: VIDI_TEST_ONLY_VAR')
  })

  it('returns the value when set', () => {
    process.env[KEY] = 'some-value'
    expect(requireEnv(KEY)).toBe('some-value')
  })
})

describe('validateEnv', () => {
  const originals: Record<string, string | undefined> = {}

  beforeEach(() => {
    for (const k of ALL_REQUIRED) originals[k] = process.env[k]
  })

  afterEach(() => {
    for (const k of ALL_REQUIRED) {
      if (originals[k] === undefined) delete process.env[k]
      else process.env[k] = originals[k]
    }
  })

  it('throws if any required var is missing', () => {
    for (const k of ALL_REQUIRED) process.env[k] = 'set'
    process.env.VIDI_PUBLIC_URL = 'https://belgium-atmosphe.re/vidi'
    delete process.env.VIDI_TOKEN_ENC_KEY
    expect(() => validateEnv()).toThrow('Missing required env var: VIDI_TOKEN_ENC_KEY')
  })

  it('does not throw when all required vars are set (non-loopback, confidential mode)', () => {
    for (const k of ALL_REQUIRED) process.env[k] = 'set'
    process.env.VIDI_PUBLIC_URL = 'https://belgium-atmosphe.re/vidi'
    expect(() => validateEnv()).not.toThrow()
  })

  it('requires VIDI_OAUTH_PRIVATE_JWK when VIDI_PUBLIC_URL is not a loopback host', () => {
    for (const k of ALL_REQUIRED) process.env[k] = 'set'
    process.env.VIDI_PUBLIC_URL = 'https://belgium-atmosphe.re/vidi'
    delete process.env.VIDI_OAUTH_PRIVATE_JWK
    expect(() => validateEnv()).toThrow('Missing required env var: VIDI_OAUTH_PRIVATE_JWK')
  })

  it('does NOT require VIDI_OAUTH_PRIVATE_JWK when VIDI_PUBLIC_URL is the loopback base', () => {
    for (const k of ALL_REQUIRED) process.env[k] = 'set'
    process.env.VIDI_PUBLIC_URL = 'http://127.0.0.1:3000/vidi'
    delete process.env.VIDI_OAUTH_PRIVATE_JWK
    expect(() => validateEnv()).not.toThrow()
  })
})
