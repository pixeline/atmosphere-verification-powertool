import type {
  NodeSavedState,
  NodeSavedStateStore,
  NodeSavedSession,
  NodeSavedSessionStore,
} from '@atproto/oauth-client-node'
import { eq } from 'drizzle-orm'
import { db } from '../../db/client'
import { oauthState, oauthSession } from '../../db/schema'
import { encryptJson, decryptJson } from '../crypto/tokenCrypto'

export class PgStateStore implements NodeSavedStateStore {
  async get(key: string): Promise<NodeSavedState | undefined> {
    const r = await db.select().from(oauthState).where(eq(oauthState.key, key))
    return r[0] ? decryptJson<NodeSavedState>(r[0].payload) : undefined
  }
  async set(key: string, val: NodeSavedState) {
    const payload = encryptJson(val)
    await db.insert(oauthState).values({ key, payload })
      .onConflictDoUpdate({ target: oauthState.key, set: { payload } })
  }
  async del(key: string) {
    await db.delete(oauthState).where(eq(oauthState.key, key))
  }
}

export class PgSessionStore implements NodeSavedSessionStore {
  async get(did: string): Promise<NodeSavedSession | undefined> {
    const r = await db.select().from(oauthSession).where(eq(oauthSession.did, did))
    return r[0] ? decryptJson<NodeSavedSession>(r[0].payload) : undefined
  }
  async set(did: string, val: NodeSavedSession) {
    const payload = encryptJson(val)
    await db.insert(oauthSession).values({ did, payload })
      .onConflictDoUpdate({ target: oauthSession.did, set: { payload } })
  }
  async del(did: string) {
    await db.delete(oauthSession).where(eq(oauthSession.did, did))
  }
}
