'use client'
import { useState } from 'react'

type TV = { did: string; handle: string }

export type SearchFilters = {
  text: string
  customDomainOnly: boolean
  followedByVerified: boolean
  verifiedByAnyOf: string[]
}

export function SearchForm({
  trustedVerifiers,
  onSearch,
}: {
  trustedVerifiers: TV[]
  onSearch: (filters: SearchFilters) => void
}) {
  const [text, setText] = useState('')
  const [customDomainOnly, setCustomDomainOnly] = useState(false)
  const [followedByVerified, setFollowedByVerified] = useState(false)
  const [verifiedByAnyOf, setVerifiedByAnyOf] = useState<string[]>([])

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        onSearch({ text, customDomainOnly, followedByVerified, verifiedByAnyOf })
      }}
    >
      <div>
        <label htmlFor="search-text">Text in bio or handle</label>
        <input id="search-text" value={text} onChange={(e) => setText(e.target.value)} />
      </div>
      <div>
        <label htmlFor="search-custom-domain">
          <input
            id="search-custom-domain"
            type="checkbox"
            checked={customDomainOnly}
            onChange={(e) => setCustomDomainOnly(e.target.checked)}
          />{' '}
          Handle is a domain
        </label>
      </div>
      <div>
        <label htmlFor="search-followed-by-verified">
          <input
            id="search-followed-by-verified"
            type="checkbox"
            checked={followedByVerified}
            onChange={(e) => setFollowedByVerified(e.target.checked)}
          />{' '}
          Followed by a verified account
        </label>
      </div>
      <fieldset>
        <legend>Verified by</legend>
        {trustedVerifiers.map((tv) => (
          <div key={tv.did}>
            <label htmlFor={`tv-${tv.did}`}>
              <input
                id={`tv-${tv.did}`}
                type="checkbox"
                onChange={(e) =>
                  setVerifiedByAnyOf((prev) =>
                    e.target.checked ? [...prev, tv.did] : prev.filter((d) => d !== tv.did)
                  )
                }
              />{' '}
              {tv.handle}
            </label>
          </div>
        ))}
      </fieldset>
      <button type="submit">Search</button>
    </form>
  )
}
