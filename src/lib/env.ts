/**
 * Centralized environment variable validation.
 *
 * Use `requireEnv` at the point of use instead of a bare `process.env.X!` —
 * the `!` assertion is a silent lie at runtime: if the var is unset, callers
 * get `undefined` (or the literal string "undefined" when interpolated into
 * a template) instead of a loud, early failure.
 *
 * `validateEnv` should be called at the top of CLI entrypoints so a
 * misconfigured deploy fails immediately instead of quietly no-oping or
 * misbehaving partway through a run.
 */
export function requireEnv(name: string): string {
  const value = process.env[name]
  if (!value) {
    throw new Error(`Missing required env var: ${name}`)
  }
  return value
}

const REQUIRED_ENV_VARS = [
  'DATABASE_URL',
  'VIDI_PUBLIC_URL',
  'VIDI_COOKIE_SECRET',
  'VIDI_TOKEN_ENC_KEY',
] as const

/**
 * True when VIDI_PUBLIC_URL points at a loopback host (127.0.0.1, localhost,
 * or [::1]). Duplicated (rather than imported) from
 * src/lib/atproto/oauthClient.ts to keep this module dependency-free of the
 * OAuth client stack — validateEnv() must be safe to call very early (e.g.
 * CLI entrypoints) before other modules are initialized.
 */
function isLoopbackPublicUrl(value: string): boolean {
  try {
    const { hostname } = new URL(value)
    return hostname === '127.0.0.1' || hostname === 'localhost' || hostname === '[::1]' || hostname === '::1'
  } catch {
    return false
  }
}

/**
 * VIDI_OAUTH_PRIVATE_JWK is only required in confidential (production) OAuth
 * mode, where it signs client-assertion JWTs for private_key_jwt auth. The
 * local loopback dev mode (VIDI_PUBLIC_URL pointing at 127.0.0.1/localhost)
 * uses the atproto special public loopback client instead
 * (token_endpoint_auth_method: 'none', no keyset), so it must not be forced
 * to set a signing key that will never be used.
 */
export function validateEnv(): void {
  for (const name of REQUIRED_ENV_VARS) {
    requireEnv(name)
  }
  const publicUrl = process.env.VIDI_PUBLIC_URL ?? ''
  if (!isLoopbackPublicUrl(publicUrl)) {
    requireEnv('VIDI_OAUTH_PRIVATE_JWK')
  }
}
