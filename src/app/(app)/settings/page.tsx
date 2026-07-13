'use client'
import { useEffect, useState } from 'react'
import { Plus, X } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { useOrg } from '@/lib/hooks/useOrg'
import { parseKeywords } from '@/lib/keywords'

type Seed = { id: number; keyword: string; enabled: boolean }

export function SettingsView({
  role,
  orgId,
  seeds: initialSeeds,
  accountsCount,
}: {
  role: string
  orgId: number
  seeds: Seed[]
  accountsCount: number | null
}) {
  const [seeds, setSeeds] = useState(initialSeeds)
  const [newKeyword, setNewKeyword] = useState('')
  const [running, setRunning] = useState(false)

  // SettingsPage mounts this component as soon as org context resolves, but
  // its crawl-seeds fetch is still in flight at that point — seeds always
  // starts empty and the real list arrives a moment later via a prop update.
  // useState's initializer only runs once, so without this effect that later
  // update would be silently dropped and the list would stay empty forever.
  useEffect(() => {
    setSeeds(initialSeeds)
  }, [initialSeeds])

  async function addKeyword() {
    // Split the entry on commas/whitespace so pasting a city list adds one
    // keyword per city; de-dupes and drops blanks.
    const parsed = parseKeywords(newKeyword)
    if (parsed.length === 0) return
    const res = await fetch('/vidi/api/crawl-seeds', {
      method: 'POST',
      body: JSON.stringify({ orgId, keywords: parsed }),
    })
    if (!res.ok) {
      toast.error(parsed.length > 1 ? 'Could not add keywords' : 'Could not add keyword')
      return
    }
    setSeeds((prev) => {
      const next = [...prev]
      for (const kw of parsed) {
        const idx = next.findIndex((s) => s.keyword.toLowerCase() === kw.toLowerCase())
        if (idx === -1) next.push({ id: Date.now() + next.length, keyword: kw, enabled: true })
        else next[idx] = { ...next[idx], enabled: true }
      }
      return next
    })
    setNewKeyword('')
  }

  async function toggle(keyword: string, enabled: boolean) {
    const res = await fetch('/vidi/api/crawl-seeds', {
      method: 'PATCH',
      body: JSON.stringify({ orgId, keyword, enabled }),
    })
    if (!res.ok) {
      toast.error('Could not update keyword')
      return
    }
    setSeeds((prev) => prev.map((s) => (s.keyword === keyword ? { ...s, enabled } : s)))
  }

  async function runCrawlNow() {
    setRunning(true)
    try {
      const res = await fetch('/vidi/api/crawl/run', { method: 'POST', body: JSON.stringify({ orgId }) })
      if (!res.ok) {
        toast.error('Could not start crawl')
        return
      }
      toast.success('Crawl queued — the worker will pick it up shortly.')
    } finally {
      setRunning(false)
    }
  }

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="text-muted-foreground">Manage crawl discovery keywords for this instance.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Crawl Keywords</CardTitle>
          <CardDescription>
            The crawler searches each enabled keyword on the network and harvests matching accounts
            into the searchable pool that Search browses
            {accountsCount != null && (
              <>
                {' — '}
                <span className="font-medium text-foreground">{accountsCount.toLocaleString()}</span>
                {' accounts harvested so far'}
              </>
            )}
            .
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <form
            className="flex items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault()
              addKeyword()
            }}
          >
            <div className="flex flex-1 flex-col gap-1">
              <Label htmlFor="new-keyword">Add keywords</Label>
              <Input
                id="new-keyword"
                value={newKeyword}
                placeholder="Brussels, Antwerp, Ghent…"
                onChange={(e) => setNewKeyword(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">Separate multiple keywords with commas or spaces.</p>
            </div>
            <Button type="submit">Add</Button>
          </form>
          <div className="flex flex-wrap gap-2">
            {seeds.map((s) => (
              <Badge
                key={s.id}
                variant={s.enabled ? 'default' : 'outline'}
                render={<button type="button" />}
                aria-pressed={s.enabled}
                onClick={() => toggle(s.keyword, !s.enabled)}
                className="cursor-pointer gap-1"
              >
                {s.keyword}
                {s.enabled ? <X className="size-3" /> : <Plus className="size-3" />}
              </Badge>
            ))}
          </div>
        </CardContent>
      </Card>

      {role === 'owner' && (
        <Button onClick={runCrawlNow} disabled={running}>
          {running ? 'Starting…' : 'Run crawl now'}
        </Button>
      )}
    </div>
  )
}

export default function SettingsPage() {
  const { orgId, role, loading } = useOrg()
  const [seeds, setSeeds] = useState<Seed[]>([])
  const [accountsCount, setAccountsCount] = useState<number | null>(null)

  useEffect(() => {
    // Keyword settings are open to any active member (owner or helper).
    if (orgId && role) {
      fetch(`/vidi/api/crawl-seeds?orgId=${orgId}`)
        .then(async (r) => {
          if (!r.ok) {
            toast.error('Could not load crawl keywords')
            return
          }
          const d = await r.json()
          setSeeds(d.seeds ?? [])
          setAccountsCount(d.accountsCount ?? null)
        })
        .catch(() => toast.error('Could not load crawl keywords'))
    }
  }, [orgId, role])

  if (loading || !orgId || !role) return null
  return <SettingsView role={role} orgId={orgId} seeds={seeds} accountsCount={accountsCount} />
}
