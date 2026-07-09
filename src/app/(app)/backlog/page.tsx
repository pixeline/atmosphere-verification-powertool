'use client'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { useOrg } from '@/lib/hooks/useOrg'
import { Button } from '@/components/ui/button'
import { AccountCard } from '@/components/AccountCard'

type BacklogItem = {
  subjectDid: string
  note?: string | null
  handle?: string
  displayName?: string | null
  description?: string | null
  isCustomDomain?: boolean
  followersCount?: number | null
  followsCount?: number | null
  lastActiveAt?: string | null
  verifiers?: { did: string; handle: string | null }[]
}

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
        <div className="flex flex-col gap-4">
          {items.map((i) => (
            <AccountCard
              key={i.subjectDid}
              acc={{
                did: i.subjectDid,
                handle: i.handle ?? i.subjectDid,
                displayName: i.displayName,
                description: i.note ?? i.description,
                isCustomDomain: i.isCustomDomain,
                followersCount: i.followersCount,
                followsCount: i.followsCount,
                lastActiveAt: i.lastActiveAt,
                verifiers: i.verifiers,
              }}
              actions={
                <>
                  <Button size="sm" onClick={() => act(i.subjectDid, 'verified')}>
                    Mark verified
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => act(i.subjectDid, 'skipped')}>
                    Skip
                  </Button>
                </>
              }
            />
          ))}
        </div>
      )}
    </div>
  )
}
