export function denylist(): Set<string> {
  return new Set((process.env.VIDI_DENYLIST_DIDS ?? '').split(',').map(s => s.trim()).filter(Boolean))
}
