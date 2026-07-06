import { Agent } from '@atproto/api'
import { getOAuthClient } from './oauthClient'

/**
 * Restores the org's stored OAuth session (persisted when the owner logged in
 * AS the org account, per Task 2.4) and returns an Agent authenticated as the
 * org's DID. Throws if there is no stored session for orgDid (org OAuth not
 * completed yet) — callers should treat that as a client error, not a 500.
 */
export async function getOrgAgent(orgDid: string): Promise<Agent> {
  const client = await getOAuthClient()
  const session = await client.restore(orgDid)
  return new Agent(session)
}
