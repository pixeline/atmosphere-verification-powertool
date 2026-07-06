'use client'
import { useEffect, useState } from 'react'

// v1: single-org context resolved from /vidi/api/org/context; stored in state.
export function useOrg() {
  const [orgId, setOrgId] = useState<number | null>(null)

  useEffect(() => {
    fetch('/vidi/api/org/context')
      .then((r) => r.json())
      .then((d) => setOrgId(d.orgId ?? null))
      .catch(() => {})
  }, [])

  return { orgId, setOrgId }
}
