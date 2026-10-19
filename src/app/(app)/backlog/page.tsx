'use client'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { useOrg } from '@/lib/hooks/useOrg'
import { notifyVerifiedCountChanged } from '@/lib/verifiedCountBus'
import { belgianSignals, type BelgianSignals } from '@/lib/belgianSignals'
import { extractDids } from '@/lib/extractDids'
import { Badge } from '@/components/ui/badge'
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

type Scored = BacklogItem & { be: BelgianSignals }

// Mirrors /api/verify's default VIDI_BATCH_MAX so bulk verifies never trip the cap.
const VERIFY_BATCH = 50
// Score ≥ 3 was ~90% precise in the list-grower's manual audit (one solid signal).
const STRONG_SCORE = 3
// The AppView reports this when a handle's DNS/well-known no longer points at
// the DID. A verification issued now would embed it and not render as valid,
// so such accounts are flagged and never bulk-selected.
const BROKEN_HANDLE = 'handle.invalid'

export default function BacklogPage() {
  const { orgId } = useOrg()
  const [items, setItems] = useState<BacklogItem[]>([])
  const [sel, setSel] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const load = useCallback(() => {
    if (!orgId) return
    fetch(`/vidi/api/backlog?orgId=${orgId}`)
      .then((r) => r.json())
      .then((d) => setItems(d.items ?? []))
      .catch(() => {})
  }, [orgId])

  useEffect(load, [load])

  // Strongest Belgian evidence first, so the reviewer can tick the obvious
  // ones in bulk and spend attention on the weak tail.
  const scored: Scored[] = useMemo(
    () =>
      items
        .map((i) => ({ ...i, be: belgianSignals({ handle: i.handle, displayName: i.displayName, description: i.description }) }))
        .sort((a, b) => b.be.score - a.be.score),
    [items],
  )

  function drop(dids: string[]) {
    const gone = new Set(dids)
    setItems((p) => p.filter((i) => !gone.has(i.subjectDid)))
    setSel((p) => new Set([...p].filter((d) => !gone.has(d))))
  }

  async function markStatus(subjectDids: string[], status: 'verified' | 'skipped') {
    return fetch('/vidi/api/backlog', {
      method: 'PATCH',
      body: JSON.stringify({ orgId, subjectDids, status }),
    })
  }

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
      await markStatus([item.subjectDid], 'verified')
    } catch {
      /* verification already landed; status update is best-effort */
    }
    drop([item.subjectDid])
    notifyVerifiedCountChanged()
    toast.success(outcome === 'skipped-duplicate' ? 'Already verified' : 'Verified')
  }

  async function skip(subjectDid: string) {
    const res = await markStatus([subjectDid], 'skipped')
    if (!res.ok) {
      toast.error('Could not update backlog item')
      return
    }
    drop([subjectDid])
    toast.success('Skipped')
  }

  async function verifySelected() {
    const targets = scored.filter((i) => sel.has(i.subjectDid))
    let done = 0
    let failed = 0
    try {
      for (let i = 0; i < targets.length; i += VERIFY_BATCH) {
        setBusy(`Verifying ${Math.min(i + VERIFY_BATCH, targets.length)}/${targets.length}…`)
        const batch = targets.slice(i, i + VERIFY_BATCH)
        const res = await fetch('/vidi/api/verify', {
          method: 'POST',
          body: JSON.stringify({
            orgId,
            subjects: batch.map((t) => ({ did: t.subjectDid, handle: t.handle, displayName: t.displayName })),
          }),
        })
        if (!res.ok) {
          failed += targets.length - i
          break
        }
        const { results } = (await res.json()) as { results: { did: string; outcome: string }[] }
        const ok = results.filter((r) => r.outcome !== 'error').map((r) => r.did)
        failed += batch.length - ok.length
        if (ok.length) {
          try {
            await markStatus(ok, 'verified')
          } catch {
            /* verifications already landed; status update is best-effort */
          }
          drop(ok)
          done += ok.length
        }
      }
    } finally {
      setBusy(null)
    }
    if (done) {
      notifyVerifiedCountChanged()
      toast.success(`Verified ${done} account${done === 1 ? '' : 's'}`)
    }
    if (failed) toast.error(`${failed} verification${failed === 1 ? '' : 's'} failed — still selected`)
  }

  async function skipSelected() {
    const dids = [...sel]
    const res = await markStatus(dids, 'skipped')
    if (!res.ok) {
      toast.error('Could not update backlog items')
      return
    }
    drop(dids)
    toast.success(`Skipped ${dids.length}`)
  }

  async function importFile(file: File) {
    const dids = extractDids(await file.text())
    if (!dids.length) {
      toast.error('No DIDs found in that file')
      return
    }
    setBusy(`Importing ${dids.length} accounts…`)
    try {
      const res = await fetch('/vidi/api/backlog/import', {
        method: 'POST',
        body: JSON.stringify({ orgId, dids }),
      })
      if (!res.ok) {
        toast.error('Import failed')
        return
      }
      const r = await res.json()
      toast.success(
        `Queued ${r.queued} · already verified ${r.alreadyVerified} · already queued ${r.alreadyInBacklog} · not found ${r.notFound}`,
      )
      load()
    } catch {
      toast.error('Import failed')
    } finally {
      setBusy(null)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  const strong = scored.filter((i) => i.be.score >= STRONG_SCORE && i.handle !== BROKEN_HANDLE)

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">To Be Verified</h1>
          <p className="text-muted-foreground">Accounts queued for review before verifying.</p>
        </div>
        <input
          ref={fileRef}
          type="file"
          accept=".csv,.tsv,.txt,text/csv,text/tab-separated-values,text/plain"
          className="hidden"
          aria-label="Import list file"
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) void importFile(f)
          }}
        />
        <Button variant="outline" disabled={!!busy} onClick={() => fileRef.current?.click()}>
          Import CSV/TSV
        </Button>
      </div>

      {scored.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-muted-foreground">
            {busy ?? `${scored.length} pending · ${strong.length} with strong Belgian signals · ${sel.size} selected`}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="ghost" disabled={!!busy} onClick={() => setSel(new Set(strong.map((i) => i.subjectDid)))}>
              Select strong
            </Button>
            <Button size="sm" variant="ghost" disabled={!!busy} onClick={() => setSel(new Set(scored.map((i) => i.subjectDid)))}>
              Select all
            </Button>
            <Button size="sm" variant="ghost" disabled={!!busy || !sel.size} onClick={() => setSel(new Set())}>
              Clear
            </Button>
            <Button size="sm" disabled={!!busy || !sel.size} onClick={verifySelected}>
              Verify selected
            </Button>
            <Button size="sm" variant="outline" disabled={!!busy || !sel.size} onClick={skipSelected}>
              Skip selected
            </Button>
          </div>
        </div>
      )}

      {scored.length === 0 ? (
        <div className="flex items-center justify-center rounded-xl border border-dashed border-border px-6 py-12 text-center text-sm text-muted-foreground">
          {busy ?? 'Nothing pending review.'}
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {scored.map((i) => (
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
              selected={sel.has(i.subjectDid)}
              onToggle={() =>
                setSel((p) => {
                  const n = new Set(p)
                  if (n.has(i.subjectDid)) n.delete(i.subjectDid)
                  else n.add(i.subjectDid)
                  return n
                })
              }
              badges={
                <>
                  {i.handle === BROKEN_HANDLE && <Badge variant="destructive">handle not resolving</Badge>}
                  <Badge
                    variant={i.be.score >= STRONG_SCORE ? 'default' : i.be.score > 0 ? 'secondary' : 'outline'}
                    title="Belgian evidence score"
                  >
                    BE {i.be.score}
                    {i.be.signals.length > 0 && ` · ${i.be.signals.join(' · ')}`}
                  </Badge>
                </>
              }
              actions={
                <>
                  <Button size="sm" disabled={!!busy} onClick={() => verify(i)}>
                    Mark verified
                  </Button>
                  <Button size="sm" variant="outline" disabled={!!busy} onClick={() => skip(i.subjectDid)}>
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
