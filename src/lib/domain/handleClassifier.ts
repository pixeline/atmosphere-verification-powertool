export const PLATFORM_SUFFIXES = ['.bsky.social', '.mu.social', '.eurosky.social']
export function isCustomDomain(handle: string): boolean {
  const h = handle.toLowerCase()
  return !PLATFORM_SUFFIXES.some((s) => h.endsWith(s))
}
