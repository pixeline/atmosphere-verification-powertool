import { NodeOAuthClient } from '@atproto/oauth-client-node'
import { Keyset } from '@atproto/jwk'
import { JoseKey } from '@atproto/jwk-jose'
import { buildAtprotoLoopbackClientId } from '@atproto/oauth-types'
import { PgStateStore, PgSessionStore } from './stores'
import { requireEnv } from '../env'

const base = () => requireEnv('VIDI_PUBLIC_URL')

/**
 * True when VIDI_PUBLIC_URL points at a loopback host (127.0.0.1, localhost,
 * or the IPv6 loopback [::1]). In this mode we run local development OAuth
 * using the atproto special loopback client instead of a hosted confidential
 * client — see clientMetadata() below.
 */
export function isLoopbackBase(base: string): boolean {
  try {
    const { hostname } = new URL(base)
    return hostname === '127.0.0.1' || hostname === 'localhost' || hostname === '[::1]' || hostname === '::1'
  } catch {
    return false
  }
}

/**
 * Builds the loopback client metadata for local development.
 *
 * Per the atproto OAuth profile, the special loopback client uses a
 * `client_id` of the `http://localhost` form, with `scope` and `redirect_uri`
 * carried as query parameters. Its `redirect_uri` MUST use the literal
 * loopback IP (127.0.0.1 or [::1]) — the hostname `localhost` is rejected by
 * the Authorization Server. We use the library's own
 * `buildAtprotoLoopbackClientId` helper (from `@atproto/oauth-types`, which
 * `@atproto/oauth-client-node` depends on) rather than hand-rolling the
 * query-string encoding, since it already validates/encodes these rules.
 *
 * The loopback client is a PUBLIC client: no keyset, no jwks,
 * `token_endpoint_auth_method: 'none'`.
 */
function loopbackClientMetadata(publicUrl: string) {
  const parsed = new URL(publicUrl)
  const redirectUri = `http://127.0.0.1${parsed.port ? `:${parsed.port}` : ''}${parsed.pathname.replace(/\/$/, '')}/api/auth/callback`
  const scope = 'atproto transition:generic'
  const clientId = buildAtprotoLoopbackClientId({ scope, redirect_uris: [redirectUri] })
  return {
    client_id: clientId,
    client_name: 'Vidi (local dev)',
    redirect_uris: [redirectUri] as [string, ...string[]],
    scope,
    grant_types: ['authorization_code', 'refresh_token'] as ['authorization_code', 'refresh_token'],
    response_types: ['code'] as ['code'],
    application_type: 'native' as const,
    token_endpoint_auth_method: 'none' as const,
    dpop_bound_access_tokens: true,
  }
}

/**
 * Confidential (production) client metadata: private_key_jwt + ES256 keyset
 * served at jwks_uri. Unchanged from before loopback support was added.
 */
function confidentialClientMetadata(publicUrl: string) {
  return {
    client_id: `${publicUrl}/client-metadata.json`,
    client_name: 'Vidi',
    client_uri: publicUrl,
    redirect_uris: [`${publicUrl}/api/auth/callback`] as [string, ...string[]],
    scope: 'atproto transition:generic',
    grant_types: ['authorization_code', 'refresh_token'] as [
      'authorization_code',
      'refresh_token',
    ],
    response_types: ['code'] as ['code'],
    application_type: 'web' as const,
    token_endpoint_auth_method: 'private_key_jwt' as const,
    token_endpoint_auth_signing_alg: 'ES256',
    dpop_bound_access_tokens: true,
    jwks_uri: `${publicUrl}/jwks.json`,
  }
}

export function clientMetadata() {
  const publicUrl = base()
  return isLoopbackBase(publicUrl) ? loopbackClientMetadata(publicUrl) : confidentialClientMetadata(publicUrl)
}

let _keyset: Keyset | null = null

/**
 * Loads the confidential client's ES256 signing key from VIDI_OAUTH_PRIVATE_JWK
 * (a JSON-encoded JWK, private key included) and builds a Keyset from it.
 * The Keyset is used both to sign client-assertion JWTs (via NodeOAuthClient)
 * and to serve the public half at GET /jwks.json.
 *
 * Only used in confidential (non-loopback) mode — the loopback public client
 * has no keyset.
 */
export async function getKeyset(): Promise<Keyset> {
  if (_keyset) return _keyset
  const raw = requireEnv('VIDI_OAUTH_PRIVATE_JWK')
  const jwk = JSON.parse(raw)
  const key = await JoseKey.fromJWK(jwk)
  _keyset = new Keyset([key])
  return _keyset
}

let _client: NodeOAuthClient | null = null
export async function getOAuthClient(): Promise<NodeOAuthClient> {
  if (_client) return _client
  const metadata = clientMetadata()
  if (isLoopbackBase(base())) {
    _client = new NodeOAuthClient({
      clientMetadata: metadata,
      stateStore: new PgStateStore(),
      sessionStore: new PgSessionStore(),
    })
    return _client
  }
  const keyset = await getKeyset()
  _client = new NodeOAuthClient({
    clientMetadata: metadata,
    keyset,
    stateStore: new PgStateStore(),
    sessionStore: new PgSessionStore(),
  })
  return _client
}
