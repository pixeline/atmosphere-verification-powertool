import { describe, it, expect } from 'vitest'
import { accounts, orgs, members } from '../../src/db/schema'
describe('schema', () => {
  it('exposes expected tables', () => {
    expect(accounts).toBeDefined()
    expect(orgs).toBeDefined()
    expect(members).toBeDefined()
  })
})
