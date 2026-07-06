'use client'

type Account = {
  did: string
  handle: string
  displayName?: string | null
  description?: string | null
  isCustomDomain?: boolean
}

export function AccountCard({
  acc,
  selected,
  onToggle,
}: {
  acc: Account
  selected: boolean
  onToggle: () => void
}) {
  return (
    <div style={{ border: '1px solid #ddd', padding: 8, borderRadius: 8 }}>
      <label htmlFor={`acc-${acc.did}`}>
        <input id={`acc-${acc.did}`} type="checkbox" checked={selected} onChange={onToggle} />{' '}
        <strong>{acc.displayName || acc.handle}</strong>
      </label>
      <div>
        @{acc.handle} {acc.isCustomDomain ? '🌐' : ''}
      </div>
      <p>{acc.description}</p>
    </div>
  )
}
