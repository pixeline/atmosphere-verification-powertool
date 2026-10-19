const DID_IN_TEXT = /did:(?:plc:[a-z2-7]{24}|web:[a-zA-Z0-9.:%-]+)/g

/** Pull every DID out of a CSV/TSV/plain-text export, whatever its columns. */
export function extractDids(text: string): string[] {
  return [...new Set(text.match(DID_IN_TEXT) ?? [])]
}
