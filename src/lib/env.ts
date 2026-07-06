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
  'VIDI_OAUTH_PRIVATE_JWK',
] as const

export function validateEnv(): void {
  for (const name of REQUIRED_ENV_VARS) {
    requireEnv(name)
  }
}
