import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MembersView } from '../../src/app/(app)/members/page'
describe('MembersView', () => {
  it('hides invite form for helpers', () => {
    render(<MembersView role="helper" members={[]} orgId={1} />)
    expect(screen.queryByText(/invite helper/i)).toBeNull()
  })
  it('shows invite form for owners', () => {
    render(<MembersView role="owner" members={[]} orgId={1} />)
    expect(screen.getByText(/invite helper/i)).toBeTruthy()
  })
})
