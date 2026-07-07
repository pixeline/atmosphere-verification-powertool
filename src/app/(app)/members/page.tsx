'use client'
import { useEffect, useRef, useState } from 'react'
import { User } from 'lucide-react'
import { toast } from 'sonner'
import { useOrg } from '@/lib/hooks/useOrg'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'

type Member = { memberDid: string; handle: string; role: string }

type Suggestion = {
  did: string
  handle: string
  displayName?: string
  avatar?: string
}

export function MembersView({ role, members, orgId }: { role: string; members: Member[]; orgId: number }) {
  const [handle, setHandle] = useState('')
  const [suggestions, setSuggestions] = useState<Suggestion[]>([])
  const [open, setOpen] = useState(false)
  // The suggestion the admin has explicitly picked. Handle + DID both come from
  // this object on submit — never from separately-typed text — which is what
  // guarantees a correct, atomic handle↔DID pairing.
  const [selected, setSelected] = useState<Suggestion | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  // Set when a suggestion is picked so the resulting value change does not
  // immediately re-open the dropdown from the debounced fetch effect.
  const justPickedRef = useRef(false)

  async function invite() {
    if (!selected) return
    const res = await fetch('/vidi/api/members', {
      method: 'POST',
      body: JSON.stringify({ orgId, handle: selected.handle, did: selected.did }),
    })
    if (!res.ok) {
      toast.error('Could not invite member')
      return
    }
    toast.success('Member invited')
    location.reload()
  }

  async function revoke(memberDid: string) {
    const res = await fetch('/vidi/api/members', {
      method: 'DELETE',
      body: JSON.stringify({ orgId, memberDid }),
    })
    if (!res.ok) {
      toast.error('Could not revoke member')
      return
    }
    toast.success('Member revoked')
    location.reload()
  }

  // Debounced typeahead: fire only for 2+ chars, 250ms after the last keystroke.
  useEffect(() => {
    if (justPickedRef.current) {
      justPickedRef.current = false
      return
    }
    const term = handle.trim()
    if (term.length < 2) {
      setSuggestions([])
      setOpen(false)
      return
    }
    const controller = new AbortController()
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/vidi/api/typeahead?q=${encodeURIComponent(term)}`, {
          signal: controller.signal,
        })
        if (!res.ok) return
        const { actors } = await res.json()
        setSuggestions(actors ?? [])
        setOpen((actors ?? []).length > 0)
      } catch {
        /* aborted or network error — ignore */
      }
    }, 250)
    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [handle])

  // Click-outside to close the dropdown.
  useEffect(() => {
    function onPointerDown(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', onPointerDown)
    return () => document.removeEventListener('mousedown', onPointerDown)
  }, [])

  function pick(s: Suggestion) {
    justPickedRef.current = true
    setHandle(s.handle)
    setSelected(s)
    setOpen(false)
    setSuggestions([])
  }

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Members</h1>
        <p className="text-muted-foreground">People who can verify accounts for this organization.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Team</CardTitle>
        </CardHeader>
        <CardContent>
          {members.length === 0 ? (
            <p className="text-sm text-muted-foreground">No members yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Handle</TableHead>
                  <TableHead>Role</TableHead>
                  {role === 'owner' && <TableHead className="text-right">Actions</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {members.map((m) => (
                  <TableRow key={m.memberDid}>
                    <TableCell>{m.handle}</TableCell>
                    <TableCell>
                      <Badge variant={m.role === 'owner' ? 'default' : 'secondary'}>{m.role}</Badge>
                    </TableCell>
                    {role === 'owner' && (
                      <TableCell className="text-right">
                        {m.role !== 'owner' && (
                          <Button size="sm" variant="destructive" onClick={() => revoke(m.memberDid)}>
                            Revoke
                          </Button>
                        )}
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {role === 'owner' && (
        <Card className="overflow-visible">
          <CardHeader>
            <CardTitle>Invite helper</CardTitle>
          </CardHeader>
          <CardContent className="overflow-visible">
            <form
              className="flex flex-col gap-4 sm:flex-row sm:items-end"
              onSubmit={(e) => {
                e.preventDefault()
                invite()
              }}
            >
              <div className="flex flex-1 flex-col gap-2">
                <Label htmlFor="invite-handle">Handle</Label>
                <div ref={containerRef} className="relative">
                  <Input
                    id="invite-handle"
                    placeholder="handle"
                    value={handle}
                    autoComplete="off"
                    aria-autocomplete="list"
                    aria-expanded={open}
                    onChange={(e) => {
                      setHandle(e.target.value)
                      // Editing the text invalidates any prior selection so we
                      // can never submit a hand-typed handle with a stale DID.
                      setSelected(null)
                    }}
                    onFocus={() => suggestions.length > 0 && setOpen(true)}
                    onKeyDown={(e) => {
                      if (e.key === 'Escape') setOpen(false)
                    }}
                  />
                  {open && suggestions.length > 0 && (
                    <ul
                      role="listbox"
                      className="absolute z-10 mt-1 max-h-72 w-full overflow-auto rounded-lg border border-border bg-popover p-1 text-popover-foreground shadow-md"
                    >
                      {suggestions.map((s) => (
                        <li key={s.did}>
                          <button
                            type="button"
                            role="option"
                            aria-selected={false}
                            onClick={() => pick(s)}
                            className="flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-muted focus-visible:bg-muted focus-visible:outline-none"
                          >
                            {s.avatar ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img
                                src={s.avatar}
                                alt=""
                                className="size-7 shrink-0 rounded-full object-cover"
                              />
                            ) : (
                              <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
                                {s.displayName?.trim() ? (
                                  s.displayName.trim().charAt(0).toUpperCase()
                                ) : (
                                  <User className="size-4" />
                                )}
                              </span>
                            )}
                            <span className="flex min-w-0 flex-col">
                              {s.displayName && (
                                <span className="truncate text-sm font-medium leading-tight">
                                  {s.displayName}
                                </span>
                              )}
                              <span className="truncate text-xs text-muted-foreground leading-tight">
                                @{s.handle}
                              </span>
                            </span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
              <Button type="submit" className="w-full sm:w-auto" disabled={!selected}>
                Invite
              </Button>
            </form>
          </CardContent>
        </Card>
      )}
    </div>
  )
}

export default function MembersPage() {
  const { orgId, role, loading } = useOrg()
  const [members, setMembers] = useState<Member[]>([])

  useEffect(() => {
    if (orgId) {
      fetch(`/vidi/api/members?orgId=${orgId}`)
        .then((r) => r.json())
        .then((d) => setMembers(d.members ?? []))
        .catch(() => {})
    }
  }, [orgId])

  if (orgId) {
    return <MembersView role={role ?? 'helper'} members={members} orgId={orgId} />
  }

  // Once the org-context fetch has resolved and there is still no org, the
  // layout already renders the appropriate onboard / no-access message, so this
  // page adds nothing. We only show a spinner while that fetch is in flight.
  if (loading) {
    return <p className="text-sm text-muted-foreground">Loading…</p>
  }
  return null
}
