'use client'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { SearchForm, type SearchFilters } from '@/components/SearchForm'
import { AccountCard } from '@/components/AccountCard'
import { Button } from '@/components/ui/button'
import { useOrg } from '@/lib/hooks/useOrg'

type TV = { did: string; handle: string }
type Account = {
  did: string
  handle: string
  displayName?: string | null
  description?: string | null
  isCustomDomain?: boolean
  verifiers?: { did: string; handle: string | null }[]
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
    if (!r.ok) {
      toast.error('Verification failed')
      return
    }
    toast.success(`Verified ${subjects.length} account${subjects.length === 1 ? '' : 's'}`)
  }

  async function backlog() {
    const targets = results.filter((x) => sel.has(x.did))
    for (const a of targets) {
      await fetch('/vidi/api/backlog', {
        method: 'POST',
        body: JSON.stringify({ orgId, subjectDid: a.did }),
      })
    }
    toast.success('Added to backlog')
  }

  return (
    <div className="flex flex-col gap-6">
      <SearchForm trustedVerifiers={tvs} onSearch={search} />

      {results.length > 0 && (
        <div className="flex items-center gap-2">
          <Button onClick={verify} disabled={!sel.size}>
            Verify selected
          </Button>
          <Button variant="outline" onClick={backlog} disabled={!sel.size}>
            Add to backlog
          </Button>
        </div>
      )}

      <div className="flex flex-col gap-4">
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
