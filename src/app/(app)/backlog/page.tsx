'use client'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { useOrg } from '@/lib/hooks/useOrg'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'

type BacklogItem = { subjectDid: string; note?: string | null }

export default function BacklogPage() {
  const { orgId } = useOrg()
  const [items, setItems] = useState<BacklogItem[]>([])

  useEffect(() => {
    if (orgId) {
      fetch(`/vidi/api/backlog?orgId=${orgId}`)
        .then((r) => r.json())
        .then((d) => setItems(d.items ?? []))
        .catch(() => {})
    }
  }, [orgId])

  async function act(subjectDid: string, status: string) {
    const res = await fetch('/vidi/api/backlog', {
      method: 'PATCH',
      body: JSON.stringify({ orgId, subjectDid, status }),
    })
    if (!res.ok) {
      toast.error('Could not update backlog item')
      return
    }
    setItems((p) => p.filter((i) => i.subjectDid !== subjectDid))
    toast.success(status === 'verified' ? 'Marked verified' : 'Skipped')
  }

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">To Be Verified</h1>
        <p className="text-muted-foreground">Accounts queued for review before verifying.</p>
      </div>

      {items.length === 0 ? (
        <div className="flex items-center justify-center rounded-xl border border-dashed border-border px-6 py-12 text-center text-sm text-muted-foreground">
          Nothing pending review.
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {items.map((i) => (
            <Card key={i.subjectDid}>
              <CardContent className="flex items-center justify-between gap-4">
                <div className="flex min-w-0 flex-col gap-0.5">
                  <span className="truncate font-mono text-xs">{i.subjectDid}</span>
                  {i.note && <span className="truncate text-sm text-muted-foreground">{i.note}</span>}
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Button size="sm" onClick={() => act(i.subjectDid, 'verified')}>
                    Mark verified
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => act(i.subjectDid, 'skipped')}>
                    Skip
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
