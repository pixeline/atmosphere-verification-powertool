'use client'
import { useEffect, useState } from 'react'
import { useOrg } from '../../../lib/hooks/useOrg'

type Member = { memberDid: string; handle: string; role: string }

export function MembersView({ role, members, orgId }: { role: string; members: Member[]; orgId: number }) {
  const [handle, setHandle] = useState('')
  const [did, setDid] = useState('')
  async function invite() {
    await fetch('/vidi/api/members', { method: 'POST', body: JSON.stringify({ orgId, handle, did }) })
    location.reload()
  }
  async function revoke(memberDid: string) {
    await fetch('/vidi/api/members', { method: 'DELETE', body: JSON.stringify({ orgId, memberDid }) })
    location.reload()
  }
  return (
    <div>
      <h2>Members</h2>
      <ul>
        {members.map((m) => (
          <li key={m.memberDid}>
            {m.handle} ({m.role})
            {role === 'owner' && m.role !== 'owner' && <button onClick={() => revoke(m.memberDid)}>Revoke</button>}
          </li>
        ))}
      </ul>
      {role === 'owner' && (
        <div>
          <h3>Invite helper</h3>
          <input placeholder="handle" value={handle} onChange={(e) => setHandle(e.target.value)} />
          <input placeholder="did:plc:…" value={did} onChange={(e) => setDid(e.target.value)} />
          <button onClick={invite}>Invite</button>
        </div>
      )}
    </div>
  )
}

export default function MembersPage() {
  const { orgId } = useOrg()
  const [role, setRole] = useState('helper')
  const [members, setMembers] = useState<Member[]>([])
  useEffect(() => {
    fetch('/vidi/api/org/context')
      .then((r) => r.json())
      .then((d) => setRole(d.role ?? 'helper'))
      .catch(() => {})
    if (orgId) {
      fetch(`/vidi/api/members?orgId=${orgId}`)
        .then((r) => r.json())
        .then((d) => setMembers(d.members ?? []))
        .catch(() => {})
    }
  }, [orgId])
  return orgId ? <MembersView role={role} members={members} orgId={orgId} /> : <p>Loading…</p>
}
