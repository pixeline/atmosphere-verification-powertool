'use client'
import { useEffect, useState } from 'react'
import { SearchForm, type SearchFilters } from '../../../components/SearchForm'
import { AccountCard } from '../../../components/AccountCard'
import { useOrg } from '../../../lib/hooks/useOrg'

type TV = { did: string; handle: string }
type Account = {
  did: string
  handle: string
  displayName?: string | null
  description?: string | null
  isCustomDomain?: boolean
}

export default function SearchPage() {
  const { orgId } = useOrg()
  const [tvs, setTvs] = useState<TV[]>([])
  const [results, setResults] = useState<Account[]>([])
  const [sel, setSel] = useState<Set<string>>(new Set())

  useEffect(() => {
    fetch('/vidi/api/trusted-verifiers')
      .then((r) => r.json())
      .then((d) => setTvs(d.verifiers ?? []))
      .catch(() => {})
  }, [])

  async function search(filters: SearchFilters) {
    const r = await fetch('/vidi/api/search', {
      method: 'POST',
      body: JSON.stringify({ orgId, filters }),
    })
    setResults((await r.json()).results ?? [])
    setSel(new Set())
  }

  async function verify() {
    const subjects = results
      .filter((a) => sel.has(a.did))
      .map((a) => ({ did: a.did, handle: a.handle, displayName: a.displayName }))
    const r = await fetch('/vidi/api/verify', {
      method: 'POST',
      body: JSON.stringify({ orgId, subjects }),
    })
    alert(JSON.stringify((await r.json()).results))
  }

  async function backlog() {
    for (const a of results.filter((x) => sel.has(x.did))) {
      await fetch('/vidi/api/backlog', {
        method: 'POST',
        body: JSON.stringify({ orgId, subjectDid: a.did }),
      })
    }
    alert('Added to backlog')
  }

  return (
    <div>
      <SearchForm trustedVerifiers={tvs} onSearch={search} />
      <div style={{ display: 'flex', gap: 8, margin: '12px 0' }}>
        <button onClick={verify} disabled={!sel.size}>
          Verify selected
        </button>
        <button onClick={backlog} disabled={!sel.size}>
          Add to backlog
        </button>
      </div>
      <div style={{ display: 'grid', gap: 8 }}>
        {results.map((a) => (
          <AccountCard
            key={a.did}
            acc={a}
            selected={sel.has(a.did)}
            onToggle={() =>
              setSel((p) => {
                const n = new Set(p)
                if (n.has(a.did)) n.delete(a.did)
                else n.add(a.did)
                return n
              })
            }
          />
        ))}
      </div>
    </div>
  )
}
