'use client'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Checkbox } from '@/components/ui/checkbox'
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
          <ul className="flex flex-col gap-2">
            {seeds.map((s) => (
              <li key={s.id} className="flex items-center gap-2">
                <Checkbox
                  id={`seed-${s.id}`}
                  checked={s.enabled}
                  onCheckedChange={(checked) => toggle(s.keyword, checked === true)}
                />
                <Label htmlFor={`seed-${s.id}`}>{s.keyword}</Label>
              </li>
            ))}
          </ul>
          <div className="flex items-end gap-2">
            <div className="flex flex-1 flex-col gap-1">
              <Label htmlFor="new-keyword">Add keyword</Label>
              <Input id="new-keyword" value={newKeyword} onChange={(e) => setNewKeyword(e.target.value)} />
            </div>
            <Button onClick={addKeyword}>Add</Button>
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
        .then((r) => r.json())
        .then((d) => setSeeds(d.seeds ?? []))
        .catch(() => {})
    }
  }, [orgId, role])

  if (loading || !orgId || !role) return null
  return <SettingsView role={role} orgId={orgId} seeds={seeds} />
}
