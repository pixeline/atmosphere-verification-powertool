// Parse a free-text keyword entry into a clean list. Commas and any whitespace
// (spaces, tabs, newlines) are interchangeable separators, so a pasted list like
// "Brussels, Antwerp, Ghent" yields one keyword per city. Empties are dropped and
// case-insensitive duplicates are collapsed, keeping the first spelling seen.
//
// Shared by the Settings UI (instant chip feedback) and the crawl-seeds API
// (authoritative, idempotent inserts) so both split identically.
export function parseKeywords(input: string): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of input.split(/[,\s]+/)) {
    const kw = raw.trim()
    if (!kw) continue
    const key = kw.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(kw)
  }
  return out
}
