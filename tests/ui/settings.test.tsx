import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { SettingsView } from '../../src/app/(app)/settings/page'

describe('SettingsView', () => {
  it('shows nothing for a helper role', () => {
    render(<SettingsView role="helper" orgId={1} seeds={[]} />)
    expect(screen.queryByText(/crawl keywords/i)).toBeNull()
  })

  it('shows the keyword list and add form for an owner', () => {
    render(
      <SettingsView
        role="owner"
        orgId={1}
        seeds={[{ id: 1, keyword: 'brussels', enabled: true }]}
      />
    )
    expect(screen.getByText(/crawl keywords/i)).toBeTruthy()
    expect(screen.getByText('brussels')).toBeTruthy()
    expect(screen.getByRole('button', { name: /add/i })).toBeTruthy()
    expect(screen.getByRole('button', { name: /run crawl now/i })).toBeTruthy()
  })
})
