import { describe, it, expect } from 'vitest'
import { parseKeywords } from '../../src/lib/keywords'

describe('parseKeywords', () => {
  it('splits a comma-and-space separated paste into one keyword per city', () => {
    expect(
      parseKeywords('Brussels, Antwerp, Ghent, Charleroi, Liège, Schaerbeek, Anderlecht, Bruges')
    ).toEqual([
      'Brussels',
      'Antwerp',
      'Ghent',
      'Charleroi',
      'Liège',
      'Schaerbeek',
      'Anderlecht',
      'Bruges',
    ])
  })

  it('treats commas, spaces, tabs and newlines as interchangeable separators', () => {
    expect(parseKeywords('brussels antwerp,ghent\tnamur\nliège')).toEqual([
      'brussels',
      'antwerp',
      'ghent',
      'namur',
      'liège',
    ])
  })

  it('collapses runs of separators and ignores leading/trailing ones', () => {
    expect(parseKeywords('  ,, brussels ,  , antwerp ,, ')).toEqual(['brussels', 'antwerp'])
  })

  it('drops case-insensitive duplicates, keeping the first spelling seen', () => {
    expect(parseKeywords('Brussels, brussels, ANTWERP, Antwerp')).toEqual(['Brussels', 'ANTWERP'])
  })

  it('returns an empty array for blank or separator-only input', () => {
    expect(parseKeywords('')).toEqual([])
    expect(parseKeywords('   ,  , \n')).toEqual([])
  })

  it('accepts a single plain keyword unchanged', () => {
    expect(parseKeywords('namur')).toEqual(['namur'])
  })
})
