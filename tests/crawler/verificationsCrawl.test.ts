import { describe, it, expect } from 'vitest'
import { mapVerificationRecords } from '../../src/crawler/verificationsCrawl'
describe('mapVerificationRecords', () => {
  it('maps records to verification edges', () => {
    const edges = mapVerificationRecords('did:plc:tv', [
      { uri: 'at://did:plc:tv/app.bsky.graph.verification/abc', value: { subject: 'did:plc:sub', handle: 'x', displayName: 'X', createdAt: '2026-01-01T00:00:00Z' } },
    ])
    expect(edges[0]).toEqual({ subjectDid: 'did:plc:sub', verifierDid: 'did:plc:tv', recordUri: 'at://did:plc:tv/app.bsky.graph.verification/abc', createdAt: '2026-01-01T00:00:00Z' })
  })
})
