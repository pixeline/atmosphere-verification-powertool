'use client'
import { useEffect, useState } from 'react'
import { useOrg } from '../../../lib/hooks/useOrg'

type BacklogItem = { subjectDid: string }

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
    await fetch('/vidi/api/backlog', { method: 'PATCH', body: JSON.stringify({ orgId, subjectDid, status }) })
    setItems((p) => p.filter((i) => i.subjectDid !== subjectDid))
  }
  return (
    <div>
      <h2>To Be Verified</h2>
      <ul>
        {items.map((i) => (
          <li key={i.subjectDid}>
            {i.subjectDid}
            <button onClick={() => act(i.subjectDid, 'verified')}>Mark verified</button>
            <button onClick={() => act(i.subjectDid, 'skipped')}>Skip</button>
          </li>
        ))}
      </ul>
    </div>
  )
}
