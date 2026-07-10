'use client'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { useOrg } from '@/lib/hooks/useOrg'
import { notifyVerifiedCountChanged } from '@/lib/verifiedCountBus'
import { Button } from '@/components/ui/button'
import { AccountCard } from '@/components/AccountCard'

type BacklogItem = {
  subjectDid: string
  note?: string | null
  handle?: string
  displayName?: string | null
  description?: string | null
  isCustomDomain?: boolean
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

  async function verify(item: BacklogItem) {
    // "Mark verified" must actually verify — issue the on-chain verification
    // record via the same service the Search page uses, not merely flip a
    // backlog status. The server re-resolves identity, so handle/displayName
    // here are only hints.
    const res = await fetch('/vidi/api/verify', {
      method: 'POST',
      body: JSON.stringify({
        orgId,
        subjects: [{ did: item.subjectDid, handle: item.handle, displayName: item.displayName }],
      }),
    })
    if (!res.ok) {
      toast.error('Verification failed')
      return
    }
    const { results } = await res.json()
    const outcome = results?.[0]?.outcome
    if (outcome === 'error') {
      toast.error('Verification failed')
      return
    }
    // Record the workflow status too, but best-effort: the verification already
    // succeeded, so a failed bookkeeping PATCH must not block the UI update or
    // the count refresh.
    try {
      await fetch('/vidi/api/backlog', {
        method: 'PATCH',
        body: JSON.stringify({ orgId, subjectDid: item.subjectDid, status: 'verified' }),
      })
    } catch {
      /* verification already landed; status update is best-effort */
    }
    setItems((p) => p.filter((i) => i.subjectDid !== item.subjectDid))
    notifyVerifiedCountChanged()
    toast.success(outcome === 'skipped-duplicate' ? 'Already verified' : 'Verified')
  }

  async function skip(subjectDid: string) {
    const res = await fetch('/vidi/api/backlog', {
      method: 'PATCH',
      body: JSON.stringify({ orgId, subjectDid, status: 'skipped' }),
    })
    if (!res.ok) {
      toast.error('Could not update backlog item')
      return
    }
    setItems((p) => p.filter((i) => i.subjectDid !== subjectDid))
    toast.success('Skipped')
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
                lastActiveAt: i.lastActiveAt,
                verifiers: i.verifiers,
              }}
              actions={
                <>
                  <Button size="sm" onClick={() => verify(i)}>
                    Mark verified
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => skip(i.subjectDid)}>
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
