'use client'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { useOrg } from '@/lib/hooks/useOrg'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'

type Member = { memberDid: string; handle: string; role: string }

export function MembersView({ role, members, orgId }: { role: string; members: Member[]; orgId: number }) {
  const [handle, setHandle] = useState('')
  const [did, setDid] = useState('')

  async function invite() {
    const res = await fetch('/vidi/api/members', {
      method: 'POST',
      body: JSON.stringify({ orgId, handle, did }),
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
        <Card>
          <CardHeader>
            <CardTitle>Invite helper</CardTitle>
          </CardHeader>
          <CardContent>
            <form
              className="flex flex-col gap-4 sm:flex-row sm:items-end"
              onSubmit={(e) => {
                e.preventDefault()
                invite()
              }}
            >
              <div className="flex flex-1 flex-col gap-2">
                <Label htmlFor="invite-handle">Handle</Label>
                <Input
                  id="invite-handle"
                  placeholder="handle"
                  value={handle}
                  onChange={(e) => setHandle(e.target.value)}
                />
              </div>
              <div className="flex flex-1 flex-col gap-2">
                <Label htmlFor="invite-did">DID</Label>
                <Input
                  id="invite-did"
                  placeholder="did:plc:…"
                  value={did}
                  onChange={(e) => setDid(e.target.value)}
                />
              </div>
              <Button type="submit" className="w-full sm:w-auto">
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
  const { orgId, role } = useOrg()
  const [members, setMembers] = useState<Member[]>([])

  useEffect(() => {
    if (orgId) {
      fetch(`/vidi/api/members?orgId=${orgId}`)
        .then((r) => r.json())
        .then((d) => setMembers(d.members ?? []))
        .catch(() => {})
    }
  }, [orgId])

  return orgId ? (
    <MembersView role={role ?? 'helper'} members={members} orgId={orgId} />
  ) : (
    <p className="text-sm text-muted-foreground">Loading…</p>
  )
}
