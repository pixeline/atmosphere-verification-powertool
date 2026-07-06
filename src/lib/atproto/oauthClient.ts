import { NodeOAuthClient } from '@atproto/oauth-client-node'
import { Keyset } from '@atproto/jwk'
import { JoseKey } from '@atproto/jwk-jose'
import { PgStateStore, PgSessionStore } from './stores'
import { requireEnv } from '../env'

const base = () => requireEnv('VIDI_PUBLIC_URL')

export function clientMetadata() {
  return {
    client_id: `${base()}/client-metadata.json`,
    client_name: 'Vidi',
    client_uri: base(),
    redirect_uris: [`${base()}/api/auth/callback`] as [string, ...string[]],
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
    jwks_uri: `${base()}/jwks.json`,
  }
}

let _keyset: Keyset | null = null

/**
 * Loads the confidential client's ES256 signing key from VIDI_OAUTH_PRIVATE_JWK
 * (a JSON-encoded JWK, private key included) and builds a Keyset from it.
 * The Keyset is used both to sign client-assertion JWTs (via NodeOAuthClient)
 * and to serve the public half at GET /jwks.json.
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
  const keyset = await getKeyset()
  _client = new NodeOAuthClient({
    clientMetadata: clientMetadata(),
    keyset,
    stateStore: new PgStateStore(),
    sessionStore: new PgSessionStore(),
  })
  return _client
}
