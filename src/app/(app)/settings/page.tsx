'use client'
import { useEffect, useState } from 'react'
import { Plus, X } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useOrg } from '@/lib/hooks/useOrg'

type Seed = { id: number; keyword: string; enabled: boolean }

export function SettingsView({
  role,
  orgId,
  seeds: initialSeeds,
}: {
  role: string
  orgId: number
  seeds: Seed[]
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

  if (role !== 'owner') return null

  async function addKeyword() {
    if (!newKeyword.trim()) return
    const res = await fetch('/vidi/api/crawl-seeds', {
      method: 'POST',
      body: JSON.stringify({ orgId, keyword: newKeyword.trim() }),
    })
    if (!res.ok) {
      toast.error('Could not add keyword')
      return
    }
    setSeeds((prev) => {
      const existing = prev.find((s) => s.keyword === newKeyword.trim())
      if (existing) return prev.map((s) => (s.keyword === newKeyword.trim() ? { ...s, enabled: true } : s))
      return [...prev, { id: Date.now(), keyword: newKeyword.trim(), enabled: true }]
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
      toast.success('Crawl started — it will run in the background.')
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
              <Label htmlFor="new-keyword">Add keyword</Label>
              <Input id="new-keyword" value={newKeyword} onChange={(e) => setNewKeyword(e.target.value)} />
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

      <Button onClick={runCrawlNow} disabled={running}>
        {running ? 'Starting…' : 'Run crawl now'}
      </Button>
    </div>
  )
}

export default function SettingsPage() {
  const { orgId, role, loading } = useOrg()
  const [seeds, setSeeds] = useState<Seed[]>([])

  useEffect(() => {
    if (orgId && role === 'owner') {
      fetch(`/vidi/api/crawl-seeds?orgId=${orgId}`)
        .then(async (r) => {
          if (!r.ok) {
            toast.error('Could not load crawl keywords')
            return
          }
          const d = await r.json()
          setSeeds(d.seeds ?? [])
        })
        .catch(() => toast.error('Could not load crawl keywords'))
    }
  }, [orgId, role])

  if (loading || !orgId || !role) return null
  return <SettingsView role={role} orgId={orgId} seeds={seeds} />
}
