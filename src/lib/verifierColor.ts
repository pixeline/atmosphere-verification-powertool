// 8 colors, each with a dark-mode variant. No database column, no admin
// configuration — the same verifier DID always deterministically hashes to
// the same entry.
const PALETTE = [
  'text-blue-600 dark:text-blue-400',
  'text-emerald-600 dark:text-emerald-400',
  'text-amber-600 dark:text-amber-500',
  'text-rose-600 dark:text-rose-400',
  'text-violet-600 dark:text-violet-400',
  'text-cyan-600 dark:text-cyan-400',
  'text-orange-600 dark:text-orange-400',
  'text-pink-600 dark:text-pink-400',
]

export function verifierColorClass(did: string): string {
  let hash = 0
  for (let i = 0; i < did.length; i++) {
    hash = (hash * 31 + did.charCodeAt(i)) | 0
  }
  return PALETTE[Math.abs(hash) % PALETTE.length]
}
