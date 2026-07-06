import { describe, it, expect } from 'vitest'
import { parseSeeds } from '../../scripts/seed'

describe('parseSeeds', () => {
  it('splits and trims env lists', () => {
    expect(parseSeeds('a, b ,c')).toEqual(['a', 'b', 'c'])
    expect(parseSeeds('')).toEqual([])
  })
})
