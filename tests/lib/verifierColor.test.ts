import { describe, it, expect } from 'vitest'
import { verifierColorClass } from '../../src/lib/verifierColor'

describe('verifierColorClass', () => {
  it('returns the same class for the same DID every time', () => {
    const a = verifierColorClass('did:plc:same')
    const b = verifierColorClass('did:plc:same')
    expect(a).toBe(b)
  })

  it('returns a non-empty className string containing a dark: variant', () => {
    const cls = verifierColorClass('did:plc:example')
    expect(cls.length).toBeGreaterThan(0)
    expect(cls).toContain('dark:')
  })

  it('is likely (not guaranteed) to differ across different DIDs', () => {
    // Not a strict requirement (palette is finite, collisions are expected
    // at scale), but two arbitrary short DIDs should not always collide —
    // this catches an accidental "always return the same class" bug.
    const colors = new Set(
      ['did:plc:aaa', 'did:plc:bbb', 'did:plc:ccc', 'did:plc:ddd', 'did:plc:eee'].map(verifierColorClass)
    )
    expect(colors.size).toBeGreaterThan(1)
  })
})
