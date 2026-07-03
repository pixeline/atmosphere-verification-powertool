import { describe, it, expect } from 'vitest'
import { GET } from '../src/app/api/health/route'

describe('health', () => {
  it('returns ok', async () => {
    const res = await GET()
    expect(await res.json()).toEqual({ status: 'ok' })
  })
})
