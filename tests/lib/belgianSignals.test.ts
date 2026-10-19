import { describe, it, expect } from 'vitest'
import { belgianSignals } from '../../src/lib/belgianSignals'

describe('belgianSignals', () => {
  it('stacks flag + city + institution', () => {
    const r = belgianSignals({ handle: 'x.bsky.social', description: '🇧🇪 researcher at KU Leuven, living in Brussel' })
    expect(r.score).toBe(3 + 2 + 2)
    expect(r.signals).toEqual(expect.arrayContaining(['🇧🇪', 'institution', 'Brussels']))
  })

  it('scores a lone .be handle as strong', () => {
    expect(belgianSignals({ handle: 'rvloock.be' })).toEqual({ score: 3, signals: ['.be handle'] })
  })

  it('treats the nationality word as weak', () => {
    expect(belgianSignals({ handle: 'a.bsky.social', description: 'Belgian beer fan' }).score).toBe(1)
  })

  it('does not fire on substrings or excluded ambiguous words', () => {
    // "namen" (NL names), "bergen" (NL mountains), "belgeo" (substring)
    expect(belgianSignals({ handle: 'a.bsky.social', description: 'namen bergen belgeo' })).toEqual({ score: 0, signals: [] })
  })

  it('counts several places once', () => {
    const r = belgianSignals({ handle: 'a.bsky.social', description: 'Gent ↔ Antwerpen' })
    expect(r.score).toBe(2)
    expect(r.signals).toEqual(['Antwerp', 'Ghent'])
  })

  it('matches accented words at their boundaries', () => {
    expect(belgianSignals({ handle: 'a.bsky.social', description: 'Woon in België, werk in Liège' }).signals).toEqual([
      'country',
      'Liège',
    ])
    expect(belgianSignals({ handle: 'a.bsky.social', description: 'xliège' }).score).toBe(0)
  })

  it('handles missing fields', () => {
    expect(belgianSignals({})).toEqual({ score: 0, signals: [] })
  })
})
