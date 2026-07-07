import { AtpAgent } from '@atproto/api'

/**
 * Unauthenticated public AppView agent for app.bsky.* reads.
 *
 * Per the atproto read-vs-write architecture, routing app.bsky.* reads
 * through the OAuth-bound org agent proxies the call through the org's PDS,
 * which for non-bsky.social PDS deployments (e.g. eurosky.social) does not
 * reliably implement the PDS-as-AppView-proxy contract and returns
 * `401 Unauthorized` even though OAuth itself succeeded. The public AppView
 * needs no scope/DPoP and works for any account regardless of which PDS
 * hosts it.
 */
export function getPublicAppViewAgent(): AtpAgent {
  return new AtpAgent({ service: process.env.VIDI_PUBLIC_APPVIEW_URL ?? 'https://public.api.bsky.app' })
}
