import { realpathSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/**
 * ESM-safe "is this module the CLI entrypoint" check.
 *
 * The naive `import.meta.url === \`file://${process.argv[1]}\`` comparison
 * breaks under a symlinked deploy path (e.g. a release symlink pointing at a
 * versioned directory): the two strings resolve to the same file on disk but
 * are spelled differently, so the guard is false, the CLI silently no-ops,
 * and the process still exits 0 — which reads as success in CI even though
 * nothing ran (e.g. an unmigrated DB).
 *
 * realpathSync resolves symlinks on both sides before comparing so the check
 * is robust to deploy-time symlinks.
 */
export function isMain(importMetaUrl: string): boolean {
  try {
    const a = realpathSync(fileURLToPath(importMetaUrl))
    const b = realpathSync(process.argv[1])
    return a === b
  } catch {
    return false
  }
}
